// fuck this retard.
global._mckay_statistics_opt_out = true;

// declarations.
const cron = require('node-cron');
const fs = require('fs');
const SteamUser = require('steam-user');

// parse command line arguments.
// command line example: npm run app.js [username, password, [app...]]
// where app arg is repeated per value, e.g: -app 730 -app 440 -app 540 -app 6969
const argv = require('yargs').argv;

// validate command line arguments.
if (argv.username === undefined || argv.password === undefined ||
  // check to see if the idle-all option is not set as well as the app array is empty.
  (argv['idle-all'] === undefined && argv.app === undefined)) {
  console.log(`Invalid command line arguments passed.`);
  console.log(`Args: username, password, [app...]`);
  console.log(`Example: --username example --password example --app 730 --app 440`);
  process.exit(1);
}

// convert argv.app to an array if only 1 app id was passed.
if (argv.app !== undefined && typeof argv.app === 'number')
  argv.app = [argv.app];

// command line option to idle every single owned steam game for 30 minute intervals.
const g_IdleAllGames = argv['idle-all'] !== undefined;
if (g_IdleAllGames)
  console.log(`Node Steam Idler will idle every single owned game.`);

const client = new SteamUser({
  // required for 'appOwnershipCached' to be emitted.
  'enablePicsCache': true
});

//
//
//
//
//
// functions.
let g_AppIDIndex = 0;         // current game id index in reference to the command line variable --app
let g_IdleInterval;           // interval handle for launchGame()
let g_ProductCache = {};      // cached results from getProductInfo(...)

const userLogOn = () => {
  return new Promise(async (resolve, reject) => {
    client.logOn({
      accountName: argv.username,
      password: argv.password
    });

    client.on('loggedOn', (details) => {
      resolve(details);
    });

    client.on('error', (error) => {
      reject(error);
    });
  });
};

const userOwnedApps = (excludeSharedLicenses) => {
  return new Promise(async (resolve, reject) => {
    client.on('appOwnershipCached', () => {
      resolve(client.getOwnedApps(excludeSharedLicenses));
    });
  });
};

const getAppInfo = (appID) => {
  return new Promise(async (resolve, reject) => {
    // firstly check to see if this appID was already cached off.
    if (g_ProductCache[appID]) {
      // store internal variable to indicate this result was cached, we could allowed the cache for this entry to be blown in future if it proves to be an issue.
      g_ProductCache[appID].__cached = true;

      resolve(g_ProductCache[appID]);
    }

    let productInfo = await client.getProductInfo([appID], []);
    if (productInfo === undefined)
      reject(`Could not get app info for ${appID}, productInfo was undefined.`);

    // product info was successfully parsed at this point, split up the data that we actually want to use.
    let appInfo = productInfo.apps[appID].appinfo;

    // store the app info in our cache so we can limit the amount of requests we do.
    g_ProductCache[appID] = appInfo;

    resolve(g_ProductCache[appID]);
  });
};

const getAppName = (appID) => {
  return new Promise(async (resolve, reject) => {
    try {
      let appInfo = await getAppInfo(appID);

      // steams productInfo call doesn't have all required fields set to default so we must sanity check here.
      if (appInfo.common === undefined)
        reject(`This app has no common object attached to it. AppID: ${appID}`);

      resolve(appInfo.common.name);
    } catch (error) {
      reject(error);
    }
  });
};

const getAppType = (appID) => {
  return new Promise(async (resolve, reject) => {
    try {
      let appInfo = await getAppInfo(appID);

      // steams productInfo call doesn't have all required fields set to default so we must sanity check here.
      if (appInfo.common === undefined)
        reject(`This app has no common object attached to it. AppID: ${appID}`);

      resolve(appInfo.common.type.toLowerCase());
    } catch (error) {
      reject(error);
    }
  });
};

// execution.
const launchGame = async () => {
  let appID = argv.app[g_AppIDIndex];

  // we don't want to idle anything that isn't a game, verify that here.
  do {
    try {
      let type = await getAppType(appID);

      // if the product info doesn't have the type attribute set as a game then skip this.
      if (type !== 'game') {
        appID = argv.app[++g_AppIDIndex];

        // clamp game id index.
        if (g_AppIDIndex >= argv.app.length)
          g_AppIDIndex = 0;
      }
      // otherwise we can idle this appID.
      else
        break;

    } catch (error) {
      // error occured, skip to next game.
      // this means there's no 'appinfo.common.type' object.
      appID = argv.app[++g_AppIDIndex];
    }
  } while (true);

  // due to the above code always running each time launchGame is invoked regardless of g_IdleAllGames
  // we can print out the appID's product name.
  try {
    let appName = await getAppName(appID);
    console.log(`Launching ${appName}`);
  } catch (error) {
    console.log(`Error retreiving app name: ${error}`);
    console.log(`Launching appID ${appID}`);
  }

  // we must set the persona state each time before we invoke gamesPlayed([...])
  client.setPersona(SteamUser.EPersonaState.Online);
  client.gamesPlayed(appID);

  // increment game id index.
  ++g_AppIDIndex;

  // clamp game id index.
  if (g_AppIDIndex >= argv.app.length)
    g_AppIDIndex = 0;
};

(async () => {
  try {
    let status = await userLogOn();
    console.log(`Successfully logged in, SteamID: ${status.client_supplied_steamid}`);

    // check to see if we should be attempting to idle all owned games and set the app id list manually.
    if (g_IdleAllGames) {
      let apps = await userOwnedApps(true);
      argv.app = apps.filter((appID) => {
        return appID > 0;
      });

      console.log(`Processed ${argv.app.length} apps available to this steam user.`);
    }

    // start launching games in a thirty minute interval.
    launchGame();
    g_IdleInterval = setInterval(launchGame, 1900 * 1000);

  } catch (error) {
    if (error.eresult === 84)
      console.log(`The error that was thrown indicates connections from this IP have been restricted by Steams Network. You can try run this script again shortly.`);

    console.log(`An error occured. Message: ${error.message}, Code: ${error.eresult}`);
    process.exit(1);
  }
})();