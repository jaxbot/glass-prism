var http = require('http');

exports.start = function(port) {
	http.createServer(httpHandler).listen(port);
}

function httpHandler(req,res) {
	var parsedUrl = url.parse(req.url, true)
	var s = parsedUrl.pathname.split("/");
	var page = s[s.length-1];

	switch (page) {
		case "subscription":
			console.log("sub");
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
						} else {
							console.log("hmm no item id");
						}
					}
					console.log(d);
					res.end("200");
				} catch (e) {
					res.end("500");
				}
			});
			break;
		case "oauth2callback":
			oauth2Client.getToken(parsedUrl.query.code, function(err,tokens) {
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

