let global = {
  baseURL: "https://mudnix.dantefalzone.repl.co",
  frontendVersion: "0.4.3",
  backendVersion: null,

  messageEventSource: null,
  autoLogoutEventSource: null,

  alreadyReadMessages: [],

  divider: "================",

  user: {
    isLoggedIn: false,
    username: null,
    password: null
  },

  helpMessages: {
    "help": "print a list of all commands",
    "echo \"<string>\"": "prints <string> to stdout",
    "sha256 \"<string>\"": "prints the SHA-256 hash of <string> to stdout",
    "new-user": "create a new account",
    "login": "log in to an existing user account",
    "logout": "log out of your account",
    "say \"<message>\"": "broadcasts <message> to everyone in your area",
    "goto \"<location>\"": "moves you to <location>",
    "map": "lists all the locations adjacent to your current location as clickable links",
    "open-chest": "opens a treasure chest if you've found one",
    "inventory": "shows you what's in your inventory",
    "check-connection": "listen to see if the server is online",
    "conn": "alias for `check-connection`"
  },

  activeTreasureChest: null
};

function getCredentials(term, usernamePrompt, passwordPrompt, callback) {
  term.read(usernamePrompt).then(function(username) {
    global.user.username = username;
  }).then(function() {
    term.set_mask(true);
    term.read(passwordPrompt).then(function(password) {
      global.user.password = password;
      term.set_mask(false);
    }).then(callback);
  });
}

/*
to machine-readable representation, e.g.
"public library of Spam Village" => "Spam_Village::public_library"
*/
function toLocationId(locationString) {
  return locationString.split(" of ")
    .map(substr => substr.replace(" ", "_"))
    .reverse()
    .join("::");
}

/*
to human-readable representation, e.g.
"Spam_Village::public_library" => "public library of Spam Village"
*/
function toHumanReadable(locationIdString) {
  return locationIdString.split("::")
    .map(substr => substr.replace("_", " "))
    .reverse()
    .join(" of ")
}

function checkConnection(term) {
  let eventSource = new EventSource(
    global.baseURL + "/check-connection",
    { withCredentials: false }
  );
  eventSource.onmessage = function(event) {
    let eventObject = JSON.parse(event.data);
    if (eventObject.alive) {
      term.echo(`Server is alive. Count: ${eventObject.count}`);
    }
  }
  return eventSource;
}

function pingServer() {
  let term = $.terminal.active();
  term.echo("Checking connection to server.");
  let eventSource = checkConnection(term);
  term.read("press Enter to stop ").then(function() {
    eventSource.close();
  });
}

function help() {
  let term = $.terminal.active();
  term.echo("List of currently supported commands:");
  for (let key of Object.keys(global.helpMessages)) {
    term.echo(`${key}: ${global.helpMessages[key]}`);
  }
}

function sha256(str) {
  let term = $.terminal.active();
  term.echo("SHA-256 hash of " + str + ":");
  fetch(`${global.baseURL}/hash/sha256?s=${str}`)
    .then((response) => response.text())
    .then((text) => term.echo(text));
}

function gotoLocation(destLocation) {
  let term = $.terminal.active();
  fetch(
    global.baseURL +
    "/game/goto?username=" + global.user.username +
    "&password=" + global.user.password +
    "&new_location_id=" + toLocationId(destLocation)
  ).then(response => response.json()).then(function(responseObject) {
    if (responseObject["succeeded"]) {
      term.echo(responseObject["info"]);
      if (responseObject["active_treasure_chest"] !== null) {
        global.activeTreasureChest = responseObject["active_treasure_chest"];
        term.echo("You have encountered a treasure chest. Run `open-chest` to open it.");
      } else if (global.activeTreasureChest !== null) {
        global.activeTreasureChest = null;
      }
    } else {
      term.error("Unable to move your character.\nReason: " + responseObject["err"]);
      term.error(
        "Perhaps you forgot to put the destination in quotation marks?"
      );
    }
  });
}

function login() {
  let term = $.terminal.active();
  if (global.user.isLoggedIn) {
    term.error("You are already logged in.");
  } else {
    getCredentials(term, "Username: ", "Password: ", function() {
      fetch(
        `${global.baseURL}/user/login?username=${global.user.username}&password=${global.user.password}`
      ).then(response => response.json()).then(function(responseObject) {
        global.user.isLoggedIn = responseObject["logged_in"];
        if (global.user.isLoggedIn) {
          term.echo("You have successfully logged in.");
          term.echo("Remember to log out before you leave so your character will be safe.");
          term.echo(global.divider);
          global.messageEventSource = new EventSource(
            global.baseURL +
            "/game/message-queue?username=" + global.user.username +
            "&password=" + global.user.password,
            { withCredentials: false }
          );
          global.messageEventSource.onmessage = function(event) {
            let eventObject = JSON.parse(event.data);
            if (eventObject.succeeded) {
              for (let message of eventObject.queue) {
                if (!global.alreadyReadMessages.some(function(readMessage) {
                  return JSON.stringify(readMessage) === JSON.stringify(message)
                })) {
                  term.echo(`${message.user}: ${message.text}`);
                  global.alreadyReadMessages.push(message);
                }
              }
            }
          }

          global.autoLogoutEventSource = new EventSource(
            global.baseURL +
            "/user/autologout?username=" + global.user.username +
            "&password=" + global.user.password,
            { withCredentials: false }
          );
          global.autoLogoutEventSource.onmessage = function(event) {
            let eventObject = JSON.parse(event.data);
            if (eventObject.succeeded && eventObject.info === "logout") {
              term.error("You have been automatically logged out due to inactivity.");
              logout();
            }
          }

          term.set_prompt(responseObject.username + "> ");
          term.echo(responseObject.info);
        } else {
          term.error("You have not logged in.\nReason: " + responseObject["err"]);
        }
      });
    });
  }
}

function logout() {
  let term = $.terminal.active();
  if (!global.user.isLoggedIn) {
    term.error("You must be logged in to log out.");
  } else {
    fetch(
      `${global.baseURL}/user/logout?username=${global.user.username}&password=${global.user.password}`
    ).then(response => response.json()).then(function(responseObject) {
      if (responseObject["logged_out"]) {
        global.user.isLoggedIn = false;
        global.user.username = null;
        global.user.password = null;
        global.messageEventSource.close();
        global.messageEventSource = null;
        global.autoLogoutEventSource.close();
        global.autoLogoutEventSource = null;
        term.echo("You have successfully logged out.");
        term.set_prompt("mudnix> ");
      } else {
        term.error("You have not logged out.\nReason: " + responseObject["err"]);
      }
    });
  }
}

function newUser() {
  let term = $.terminal.active();
  getCredentials(term, "Enter your desired username: ", "Enter your desired password: ", function() {
    fetch(
      `${global.baseURL}/user/new-user?username=${global.user.username}&password=${global.user.password}`,
      { method: "POST" }
    ).then((response) => response.text()).then((text) => term.echo(text));
  });
}

function adminTeleport(destLocation) {
  let term = $.terminal.active();
  fetch(
    global.baseURL +
    "/game/tp?username=" + global.user.username +
    "&password=" + global.user.password +
    "&new_location=" + destLocation
  ).then(response => response.json()).then(function(responseObject) {
    if (responseObject.succeeded) {
      term.echo(responseObject.info);
    } else {
      term.error("Unable to move your character.\nReason: " + responseObject["err"]);
    }
  });
}

function map() {
  let term = $.terminal.active();
  fetch(
    `${global.baseURL}/game/map?username=${global.user.username}&password=${global.user.password}`
  ).then(response => response.json()).then(function(responseObject) {
    if (responseObject.succeeded) {
      term.echo("Locations adjacent to you (click to travel to a location):");
      for (let locationId of responseObject.locations) {
        let link =
          `<a href="javascript:void(0);"
            onclick="gotoLocation('${locationId}');"
            style="color:#FFFF00">${toHumanReadable(locationId)}</a>`;
        term.echo($(link));
      }
    } else {
      term.error("Unable to retrieve the requested data.\nReason: " + responseObject["err"]);
    }
  });
}

function openChest() {
  let term = $.terminal.active();
  if (!global.user.isLoggedIn) {
    term.error("You are not logged in.");
  } else if (global.activeTreasureChest === null) {
    term.error("You are not near a treasure chest.");
  } else {
    term.echo("You open the treasure chest.");
    if (global.activeTreasureChest.contents.length === 0) {
      term.echo("The chest is empty.");
    } else {
      term.echo("The chest contains the following items:");
      for (let item of global.activeTreasureChest.contents) {
        term.echo(item.name);
      }
      term.echo("You take the items from the chest and add them to your inventory.");
    }
    fetch(
      global.baseURL +
      "/game/close-chest?username=" + global.user.username +
      "&password=" + global.user.password
    ).then(response => response.json()).then(function(responseObject) {
      term.echo(responseObject.info);
      global.activeTreasureChest = null;
    });
  }
}

function inventory() {
  let term = $.terminal.active();
  if (!global.user.isLoggedIn) {
    term.error("You are not logged in.");
  } else {
    fetch(
      global.baseURL +
      "/user/inventory?username=" + global.user.username +
      "&password=" + global.user.password
    ).then(response => response.json()).then(function(responseObject) {
      if (responseObject.succeeded) {
        responseObject.inventory.forEach(function(item) {
          term.echo(global.divider);
          term.echo(`Item: ${item.name} (quantity ${item.qty})`);
          term.echo(`Rarity: ${item.rarity}`);
          term.echo(`Description: ${item.description}`);
        });
      } else {
        term.error("Unable to get inventory.");
        term.error("Reason: " + responseObject.err);
      }
    });
  }
}

function say(message) {
  let term = $.terminal.active();
  fetch(
    global.baseURL +
    "/game/say?username=" + global.user.username +
    "&password=" + global.user.password +
    "&message=" + message,
    { method: "POST" }
  ).then(response => response.text()).then(function(response) {
    if (response !== "Ok") {
      term.error("Your message was not sent.");
      term.error("Error message: " + response);
    }
  });
}

function setUpTerminal() {
  $("#main").terminal({

    // utility commands
    "echo": function(str) { this.echo(str); },
    "help": help,
    "sha256": sha256,
    "check-connection": pingServer,
    "conn": pingServer,

    // account management commands
    "new-user": newUser,
    "login": login,
    "logout": logout,

    // game commands
    "tp": adminTeleport,
    "goto": gotoLocation,
    "map": map,
    "open-chest": openChest,
    "inventory": inventory,
    "say": say

  }, {
    greetings: `Welcome to Mudnix
Client v${global.frontendVersion} backend v${global.backendVersion} (pre-alpha)
${global.divider}
Type "new-user" to create a new account.
Type "login" if you already have an account.
Type "help" for a list of commands.`,
    name: "mudnix",
    height: 480,
    width: 800,
    prompt: "mudnix> "
  });
}

fetch(`${global.baseURL}/version`)
  .then(response => response.text())
  .then(function(version) { global.backendVersion = version })
  .then(function() { $(setUpTerminal) });

window.onbeforeunload = function() {
  if (global.user.isLoggedIn) {
    logout();
    return "";
  } else {
    return null;
  }
}
