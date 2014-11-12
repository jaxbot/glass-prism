/* Prism
 * A Node.js framework for Google Glass Mirror API applications
 */

// include standard node libraries
var url = require('url');
var fs = require('fs');
var http = require('http');
var events = require('events');
var util = require('util');

// make this module an event emitter
module.exports = exports = new events.EventEmitter();

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
var config = {};

// initialize the API, web server, etc.
function init(configinput, callback) {
	config = configinput;

	// load all cards and turn into templates
	if (!config.noCardTemplates)
		exports.cards = initCards();

	// either load client tokens from a file, or use the ones given
	if (!config.clientTokens)
		client_tokens = initClientTokens(config.tokenFileName);
	else
		client_tokens = config.clientTokens;

	oauth2Client = new googleapis.OAuth2Client(
		config.client_id, config.client_secret, config.redirect_dir);

	// discover the google API endpoints for the mirror API
	googleapis.discover('mirror','v1').execute(function(err,client) {
		// make this accessible to the class
		mirror = client.mirror;
		exports.mirror = mirror;

		// the http interface allows connecting with the Google APIs
		if (!config.noHttpInterface)
			http.createServer(httpHandler).listen(config.port || 8099);

		// [re]install the subscriptions to existing clients
		for (var index = 0; index < client_tokens.length; index++) {
			if (config.subscribe)
				installSubscription(client_tokens[index], index);
			if (config.displayName)
				installContact(client_tokens[index]);
		}

		logOnErr(err);
		callback(err);
	});
}

// handler for the HTTP requests, which are used to OAuth with the Google API.
function httpHandler(req,res) {
	var parsedUrl = url.parse(req.url, true)
	var s = parsedUrl.pathname.split("/");
	var page = s[s.length-1];

	// requested by Google; the subscription callback should be set to point
	// to this endpoint, and it should be publicly accessible over SSL
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

				if (d.itemId) {
					mirrorCall(mirror.timeline.get({
						id: d.itemId
					}), d.token, function(err,data) {
						exports.emit('subscription', err, {
							data: d, item: data });
					});
				} else {
					exports.emit('subscription', null, { data: d });
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

	// this endpoint should be defined on the Google API console for redirect
	// after the user signs in
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
				if (config.subscribe)
					installSubscription(tokens, index);

				// add contact interface
				if (config.displayName)
					installContact(tokens);

				exports.emit('newclient', tokens);

				if (config.postAuthorizationCallback)
					config.postAuthorizationCallback(res, tokens);
				else {
					res.writeHead(302, { "Location": "success" });
					res.end();
				}
			}
		});
		return;
	}

	// redirected to upon OAuth success. This prevents the page from being
	// reloaded and the OAuth failing upon return
	if (page === "success")
		return sendHtmlReply(res, "success");

	// redirect to Google for OAuth sign on
	if (page === "authorize") {
		var uri = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			approval_prompt: 'force',
			scope: config.scopes || 'https://www.googleapis.com/auth/glass.timeline'
		});
		res.writeHead(302, { "Location": uri });
		res.end();
		return;
	}

	if (config.routes) {
		for (key in config.routes) {
			if (s[s.length - 2] == key) {
				config.routes[key](req, res, s);
				return;
			}
		}
	}

	// default fallback
	sendHtmlReply(res, "index");
}

function sendHtmlReply(res, page) {
	res.writeHead(200, { 'Content-type': 'text/html' });

	var overridePage = __dirname + "/../../pages/" + page + ".html";
	var defaultPage = __dirname + "/pages/" + page + ".html";
	var finalFallback = "pages/" + page + ".html";

	try {
		fs.createReadStream(overridePage).pipe(res);
	} catch (e) {
		try {
			fs.createReadStream(defaultPage).pipe(res);
		} catch (e) {
			try {
				fs.createReadStream(finalFallback).pipe(res);
			} catch (e) {
				logOnErr(e);
			}
		}
	}
}

/* insertCard
 * Insert a card for a specific user token
 */
function insertCard(options, tokens, callback) {
	if (!options.menuItems)
		options.menuItems = [
			{"action":"DELETE"},
			{"action":"TOGGLE_PINNED"},
		];

	mirrorCall(mirror.timeline.insert(options), tokens, callback);
};

/* updateCard
 * Update a single card by sourceItemId
 */
function updateCard(options, tokens, callback) {
	mirrorCall(
		mirror.timeline.list({ "sourceItemId": options.sourceItemId,
			"isPinned": options.isPinned || true }),
		tokens,
		function(err,data) {
			logOnErr(err);

			if (data && data.items.length > 0) {
				options.id = data.items[0].id;
				patchCard(options, tokens, callback);
			} else {
				insertCard(options, tokens, callback);
			}
		}
	);
}

/* deleteBundle
 * delete all items matching a bundleId
 */
function deleteBundle(options, tokens, callback) {
	mirrorCall(
		mirror.timeline.list(options),
		tokens,
		function(err,data) {
			for (var j = 0; j < data.items.length; j++) {
				options.id = data.items[j].id;
				deleteCard(options, callback);
			}
		});
}

/* deleteCard
 * Delete a card by id
 */
function deleteCard(options, tokens, callback) {
	mirrorCall(
		mirror.timeline.delete(options),
		tokens,
		callback);
}

/* patchCard
 * Update a card in-place by id
 */
function patchCard(options, tokens, callback) {
	mirrorCall(
		mirror.timeline.patch({ "id": options.id }, options),
		tokens,
		callback);
}

/* Make an API call with the Mirror API, using a specific token
 */
function mirrorCall(call, tokens, callback) {
	oauth2Client.credentials = tokens;
	call.withAuthClient(oauth2Client).execute(callback || logOnErr);
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

// Helper function to log any problems we run into when calling APIs
function logOnErr(err) {
	if (err && !config.noOutputErrors) {
		console.warn(err);
		console.trace();
	}
}

// Load the card templates
function initCards() {
	var cards = {}
	var files;
	var dir;

	try {
		dir = __dirname + "/../../cards/";
		files = fs.readdirSync(dir);
	} catch(e) {
		try {
			dir = "cards/";
			files = fs.readdirSync(dir);
		} catch (e) {
			files = [];
		}
	}

	for (var i = 0; i < files.length; i++) {
		cards[files[i].replace('.html','')] = dot.template(
			fs.readFileSync(dir + files[i]));
	}

	return cards;
}

// Load in the tokens we store
function initClientTokens(filename) {
	var filename = filename || ".clienttokens.json";

	// read the connected users information from disk
	try {
		var filedata = fs.readFileSync(filename);
		if (filedata) {
			return JSON.parse(filedata.toString());
		}
	} catch(e) {
		logOnErr("Info: failed to load clienttoken file " + filename +
			", using blank array");
	}
	return [];
}

// Save the tokens we store
function updateClientTokens(filename) {
	fs.writeFile(filename || ".clienttokens.json",
		JSON.stringify(client_tokens,null,5));
}

// Export our precious with the outside world

exports.init = init;
exports.insertCard = insertCard;
exports.updateCard = updateCard;
exports.deleteBundle = deleteBundle;
exports.deleteCard = deleteCard;
exports.patchCard = patchCard;
exports.mirrorCall = mirrorCall;
exports.mirror = mirror;
exports.client_tokens = function () {
	return client_tokens;
}
exports.updateClientTokens = updateClientTokens;

exports.all = {}

for (key in exports) {
	(function(key) {
		exports.all[key] = function(options,callback) {
			for (var i = 0; i < client_tokens.length; i++) {
				exports[key](options, client_tokens[i], callback);
			}
		}
	})(key);
}

