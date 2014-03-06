/* Prism Entry Point
 * A Node.js framework for Google Glass Mirror API applications
 */

// include standard node libraries
var http = require('http');
var url = require("url");
var fs = require('fs');

// google api stuff
var googleapis = require('googleapis');
var oauth2Client;

// will be set to the results of API discovery
var mirror = null;

// dot templates for the cards
var dot = require('dot');
exports.cards = {};

// user card storage
var client_tokens = [];

var config = {};

var callbacks = {};

function init(config, callback) {
	// load all cards and turn into templates
	var files = fs.readdirSync("cards/");
	for (var i = 0; i < files.length; i++) {
		exports.cards[files[i].replace('.html','')] = dot.template(fs.readFileSync("cards/"+files[i]))
	}
	
	// read the connected users information from disk
	try {
		var filedata = fs.readFileSync(".clienttokens.json");
		if (filedata) {
			client_tokens = JSON.parse(filedata.toString());
		}
	} catch(e) {
		logOnErr("Info: failed to load .clienttokens.json, using blank array");
		client_tokens = [];
	}

	oauth2Client = new googleapis.OAuth2Client(config.client_id, config.client_secret, config.redirect_dir);

	this.config = config;

	if (config.callbacks.subscription)
		callbacks.subscriptionCallback = config.callbacks.subscription;
	if (config.callbacks.newclient)
		callbacks.newClientCallback = config.callbacks.newclient;

	googleapis.discover('mirror','v1').execute(function(err,client) {
		mirror = client.mirror;

		http.createServer(httpHandler).listen(config.port);

		logOnErr(err);
		callback(err);
	});
}

/* insertCard
 * Insert a card for a specific user token
 */
function insertCard(options,callback) {
	mirrorCall(mirror.timeline.insert({
		"html": options.card,
		"menuItems": [
			{"action":"REPLY"},
			{"action":"TOGGLE_PINNED"},
			{"action":"DELETE"}
		],
		"sourceItemId": options.id
	}),options.tokens,callback);
};

/* updateAllCards
 * Update cards for all users by id
 */
function updateAllCards(options) {
	for (var i = 0; i < client_tokens.length; i++)
		updateCard({ tokens: client_tokens[i], card: options.card, pinned: options.pinned, id: options.id });
}

/* updateCard
 * Update a single card
 */
function updateCard(options,callback) {
	console.log(options);
	mirrorCall(
		mirror.timeline.list({ "sourceItemId": options.id, "isPinned": options.pinned || true }),
		options.tokens,
		function(err,data) {
			logOnErr(err);
			console.log(data);

			if (data && data.items.length > 0) {
				mirrorCall(mirror.timeline.patch({"id": data.items[0].id }, {"html": options.card}), options.tokens, callback);
			} else {
				insertCard(options,callback);
			}
	});
}

/* Make an API call with the Mirror API, using a specific token
 */
function mirrorCall(call, tokens, callback) {
	oauth2Client.credentials = tokens;
	call.withAuthClient(oauth2Client).execute(callback);
}

exports.mirrorCall = mirrorCall;
exports.updateCard = updateCard;
exports.insertCard = insertCard;
exports.updateAllCards = updateAllCards;
exports.init = init;
	
function httpHandler(req,res) {
	var parsedUrl = url.parse(req.url, true)
	var s = parsedUrl.pathname.split("/");
	var page = s[s.length-1];

	switch (page) {
		case "subscription":
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
					console.log(d);

					if (d.verifyToken != config.verify_hash) {
						console.log("Bad hash!");
						res.end();
						return;
					}

					if (!client_tokens[d.userToken]) {
						console.log("Bad user token");
						res.end();
						return;
					}

					d.token = client_tokens[d.userToken];

					if (callbacks.subscriptionCallback) {
						if (d.itemId) {
							mirrorCall(mirror.timeline.get({
								id: d.itemId
							}), d.token, function(err,data) {
								callbacks.subscriptionCallback(err, { data: d, item: data });
							});
						}
					}
					res.end(200);
				} catch (e) {
					res.end(500);
				}
			});
			break;
		case "oauth2callback":
			oauth2Client.getToken(u.query.code, function(err,tokens) {
				if (err) {
					console.log(err);
					res.writeHead(500);
					res.write("Uh oh: The token login failed. Chances are you loaded a page that was already loaded. Try going back and pressing the 'get it on glass' button again.");
					res.end();
				} else {
					var index = client_tokens.push(tokens) - 1;

					fs.writeFile(".clienttokens.json", JSON.stringify(client_tokens,null,5));

					client_tokens.push(tokens);

					oauth2Client.credentials = tokens;

					// add subscriptions
					if (config.callbacks.subscription) {
						mirrorCall(mirror.subscriptions.insert({
							"callbackUrl": config.subscription_callback,
							"collection": "timeline",
							"operation": [], // empty set = all
							"userToken": index,
							"verifyToken": config.verify_hash
						}), tokens, logOnErr);
					}

					// add contact interface
					if (config.contactName) {
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

					if (callbacks.newClientCallback)
						callbacks.newClientCallback(tokens);

					res.writeHead(302, { "Location": "success" });
					res.end();
				}
			});
			break;
		case "success":
			res.writeHead(200, { 'Content-type': 'text/html' });
			fs.createReadStream("pages/success.html").pipe(res);
			break;
		case "authorize":
			var uri = oauth2Client.generateAuthUrl({
				access_type: 'offline',
				approval_prompt: 'force',
				scope: 'https://www.googleapis.com/auth/glass.timeline'
			});
			res.writeHead(302, { "Location": uri });
			res.end();
			break;
		default:
			res.writeHead(200, { 'Content-type': 'text/html' });
			fs.createReadStream("pages/index.html").pipe(res);
			break;
	}
};

function logOnErr(err) {
	if (err)
		console.log(err);
}

