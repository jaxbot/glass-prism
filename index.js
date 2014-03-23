/* Prism
 * A Node.js framework for Google Glass Mirror API applications
 */

// include standard node libraries
var url = require('url');
var fs = require('fs');

// local helpers
var http = require('http');

// dot templates for the cards
var dot = require('dot');
exports.cards = {};

// google api stuff
var googleapis = require('googleapis');
var oauth2Client;

// will be set to the results of API discovery
var mirror = null;

// user card storage
var client_tokens = [];

// options sent from the main application
var callbacks = {};
var config = {};

function init(configinput, callback) {
	config = configinput;

	// load all cards and turn into templates
	if (!config.noCardTemplates)
		exports.cards = initCards();

	if (!config.clientTokens)
		client_tokens = initClientTokens(config.tokenFileName);
	else
		client_tokens = config.clientTokens;

	oauth2Client = new googleapis.OAuth2Client(
		config.client_id, config.client_secret, config.redirect_dir);

	if (config.callbacks.subscription)
		callbacks.subscriptionCallback = config.callbacks.subscription;
	if (config.callbacks.newclient)
		callbacks.newClientCallback = config.callbacks.newclient;

	googleapis.discover('mirror','v1').execute(function(err,client) {
		mirror = client.mirror;

		// the http interface allows connecting with the Google APIs
		if (!config.noHttpInterface)
			http.createServer(httpHandler).listen(port);

		// reinstall the subscriptions, in case a change or crash occurred
		for (var index = 0; index < client_tokens.length; index++) {
			if (config.subscription_callback)
				installSubscription(client_tokens[index], index);
			if (config.displayName)
				installContact(client_tokens[index]);
		}

		logOnErr(err);
		callback(err);
	});
}

function httpHandler(req,res) {
	var parsedUrl = url.parse(req.url, true)
	var s = parsedUrl.pathname.split("/");
	var page = s[s.length-1];

	if (page === "subscription") {
		var postBody = "";
		req.on("data",function(data) {
			postBody += data;
			if (postBody.length > 1024 * 1024) {
				postBody = null;
				req.end();
			}
		});
		req.on("end", function(data) {
			try {
				var d = JSON.parse(postBody);

				if (d.verifyToken != config.verify_hash) {
					logOnErr("Info: A bad verify hash was received.");
					res.end();
					return;
				}

				if (!client_tokens[d.userToken]) {
					logOnErr("Info: A bad user token was received.");
					res.end();
					return;
				}

				d.token = client_tokens[d.userToken];

				if (callbacks.subscriptionCallback) {
					if (d.itemId) {
						mirrorCall(mirror.timeline.get({
							id: d.itemId
						}), d.token, function(err,data) {
							callbacks.subscriptionCallback(err,
								{ data: d, item: data });
						});
					}
				}
				res.end("200");
			} catch (e) {
				logOnErr("Error in subscription reading.");
				logOnErr(e);

				// send the string 500, not the response header, so that Google
				// will continue giving us subscriptions in the future.
				res.end("500");
			}
		});
		return;
	}

	if (page === "oauth2callback") {
		oauth2Client.getToken(parsedUrl.query.code, function(err,tokens) {
			if (err) {
				res.writeHead(500);
				res.write("Uh oh: The token login failed." +
					"Chances are you loaded a page that was already loaded." +
					"Try going back and pressing 'get it on glass' again.");
				res.end();
			} else {
				var index = client_tokens.push(tokens) - 1;

				if (!config.clientTokens)
					updateClientTokens(config.tokenFileName);

				// add subscriptions
				if (config.subscription_callback)
					installSubscription(tokens, index);

				// add contact interface
				if (config.contactName)
					installContact(tokens);

				if (callbacks.newClientCallback)
					callbacks.newClientCallback(tokens);

				res.writeHead(302, { "Location": "success" });
				res.end();
			}
		});
		return;
	}

	if (page === "success") {
		res.writeHead(200, { 'Content-type': 'text/html' });
		fs.createReadStream("pages/success.html").pipe(res);
		return;
	}

	if (page === "authorize") {
		var uri = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			approval_prompt: 'force',
			scope: 'https://www.googleapis.com/auth/glass.timeline'
		});
		res.writeHead(302, { "Location": uri });
		res.end();
		return;
	}

	// default fallback
	res.writeHead(200, { 'Content-type': 'text/html' });
	fs.createReadStream("pages/index.html").pipe(res);
}


/* insertCard
 * Insert a card for a specific user token
 */
function insertCard(options,callback) {
	if (!options.menuItems)
		options.menuItems = [
				{"action":"DELETE"},
				{"action":"TOGGLE_PINNED"},
			];
	if (!options.bundleId)
		options.bundleId = "";
	if (!options.isBundleCover)
		options.isBundleCover = false;

	mirrorCall(mirror.timeline.insert({
		"html": options.html,
		"menuItems": options.menuItems,
		"sourceItemId": options.sourceItemId,
		"bundleId": options.bundleId,
		"isBundleCover": options.isBundleCover
	}),options.tokens,callback);
};

/* updateAllCards
 * Update cards for all users by id
 */
function updateAllCards(options) {
	for (var i = 0; i < client_tokens.length; i++) {
		options.tokens = client_tokens[i];
		updateCard(options);
	}
}

/* updateCard
 * Update a single card
 */
function updateCard(options,callback) {
	mirrorCall(
		mirror.timeline.list({ "sourceItemId": options.sourceItemId,
			"isPinned": options.pinned || true }),
		options.tokens,
		function(err,data) {
			logOnErr(err);

			if (data && data.items.length > 0) {
				mirrorCall(mirror.timeline.patch({ "id": data.items[0].id },
					{ "html": options.html }), options.tokens, callback);
			} else {
				insertCard(options,callback);
			}
	});
}

function deleteBundle(options) {
	for (var i = 0; i < client_tokens.length; i++) {
		options.tokens = client_tokens[i];
		mirrorCall(
			mirror.timeline.list({ "bundleId": options.bundleId }),
			options.tokens,
			function(err,data) {
				for (var j = 0; j < data.items.length; j++) {
					options.id = data.items[j].id;
					deleteCard(options);
				}
			}
		);
	}
}

function deleteCard(options) {
	mirrorCall(
		mirror.timeline.delete({ "id": options.id }),
		options.tokens,
		logOnErr);
}

function patchCard(options,callback) {
	mirrorCall(
		mirror.timeline.patch({ "id": options.id }, { "html": options.html }),
		options.tokens,
		callback);
}

/* Make an API call with the Mirror API, using a specific token
 */
function mirrorCall(call, tokens, callback) {
	oauth2Client.credentials = tokens;
	call.withAuthClient(oauth2Client).execute(callback);
}
	
function logOnErr(err) {
	if (err && !config.noOutputErrors)
		console.warn(err);
}

function installSubscription(tokens,index) {
	mirrorCall(mirror.subscriptions.insert({
		"callbackUrl": config.subscription_callback,
		"collection": "timeline",
		"operation": [], // empty set = all
		"userToken": index,
		"verifyToken": config.verify_hash
	}), tokens, logOnErr);
}

function installContact(tokens) {
	mirrorCall(mirror.contacts.insert({
		"id": "prism_contact_provider_"+config.id,
		"displayName": config.displayName,
		"speakableName": config.speakableName,
		"imageUrls": [config.contactIcon],
		"priority": 7,
		"acceptCommands": [
			{"type":"POST_AN_UPDATE"}
		]
		}), tokens, logOnErr);
}

function initCards() {
	var cards = {}

	try {
		var files = fs.readdirSync("cards/");
		for (var i = 0; i < files.length; i++) {
			cards[files[i].replace('.html','')] = dot.template(
				fs.readFileSync("cards/"+files[i]));
		}
	} catch(e) {
		logOnErr("Info: no cards folder, but noCardTemplates was not set");
	}

	return cards;
}

function initClientTokens(filename) {
	var filename = filename || ".clienttokens.json";

	// read the connected users information from disk
	try {
		var filedata = fs.readFileSync(filename);
		if (filedata) {
			client_tokens = JSON.parse(filedata.toString());
		}
	} catch(e) {
		logOnErr("Info: failed to load clienttoken file " + filename +
			", using blank array");
		client_tokens = [];
	}
}

function updateClientTokens(filename) {
	fs.writeFile(filename || ".clienttokens.json",
		JSON.stringify(client_tokens,null,5));
}

exports.mirrorCall = mirrorCall;
exports.updateCard = updateCard;
exports.insertCard = insertCard;
exports.updateAllCards = updateAllCards;
exports.deleteBundle = deleteBundle;
exports.init = init;

