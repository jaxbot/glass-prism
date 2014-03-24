# Glass Prism

A Node.js framework and boilerplate for Google Glass Mirror applications.

## Getting started

```
npm install glass-prism
```

Create an application in the [Google API Console](https://console.developers.google.com/). [Here's a tutorial about that.](http://okaysass.com/posts/14-03-16-tutorial-node-js-mirror-api-google-glass)

Example application:

```
var prism = require("glass-prism");

prism.init({
	"client_id": "3489342843-383i3euefwjkf.apps.googleusercontent.com",
	"client_secret": "kjsdlDKLJSSDLSDJsdkjsdkl",
	"redirect_dir": "http://localhost:8099/oauth2callback"
}, function() {
	console.log('Ready to roll!');
	prism.all.insertCard({ text: "Hello, world!" });
});

prism.on('newclient', function(tokens) {
	prism.insertCard({ html: prism.cards.main("Hi!") }, tokens);
});

```

## Cards

Prism automatically compiles together card templates for your use.
Simply place HTML cards in cards/, and they will be converted into a doT template function
stored in prism.cards. For example:

```
<article>
	<section>
		<div class="text-auto-size">
			<p>{{=it.config.hostname}}</p>
			<p>
				<span class='{{=it.cpuColor}}'>{{=it.avg}}</span>
			</p>
			<p class='{{=it.memColor}}'>{{=it.memused}}/{{=it.memtotal}}mb</p>
		</div>
	</section>
	<footer><div>{{=it.uptime}}</div></footer>
</article>
```

```
var args = {
	uptime: 0,
	avg: 0,
	memtotal: 0,
	memused: 0,
	cpuColor: 'green',
	memColor: 'green',
	config: config
};
var html = prism.cards.main(args);
prism.insertCard({ html: html }, tokens);
```

The [Mirror API playground](https://developers.google.com/glass/tools-downloads/playground) is a great place to create HTML for your cards.

More information [about doT templates](http://olado.github.io/doT/index.html).

## Configuration options

These are passed to the init function as a JSON object.

```
{
	/* required, obtain from the Google API console */
	"client_id": "",
	"client_secret": "",
	// should be set to point to this application's port and machine
	"redirect_dir": "",

	/* optional tweaking */
	// http interface. this is used to authorize via OAuth with the Google APIs
	"port": 8099,

	// default not set, can be a manual array of client tokens
	// if used, make sure refresh tokens are included!
	"clientTokens": null,

	// file that stores client tokens of users
	"tokenFileName": ".clienttokens.json",
	// disable scanning for card templates
	"noCardTemplates": null,
	// disable the HTTP interface. If this is set, client tokens will need to be provided
	"noHttpInterface": null,
	// whether or not we care about subscribers
	"subscribe": null,
	// if set, a contact interface for -post an update to- is created
	"displayName": null,

	// if subscriptions are used, this string is used to confirm that Google sent the
	// subscription
	"verify_hash": null,
	
	// this is the actual URL Google sends a POST request to. This *must* be publicly
	// accessible over HTTPS (with valid SSL working).
	// If you only care about sending stuff to the device, you can ignore this safely.
	"subscription_callback": null,
	
	// the phonetic name for the contact
	"speakableName": null,

	// an icon for the endpoint, shown in the Glass post menu
	"contactIcon": null,

	// if set, nothing will be output to the console
	"noOutputErrors": null
}
```

The following events are emitted from the framework:

`newclient` : a new client has connected. Passes `tokens` as the argument, an object containing the connect user's OAuth tokens

`subscription` : a subscription from the Google API has been received. Occurs when a card is replied to, deleted, pinned, etc.

## Methods and properties

```
function init(configinput, callback)
```

Used to initialize the Prism interface and discover the Google API endpoints. Executes callback(err) when completed.

```
insertCard(options, tokens, [callback])
```

Insert a card to the device authed with `token`, where `token` can be obtained from a [callback] or
the `client_tokens` property. `options` is the JSON object to send to the Mirror API. callback is sent (err, data).

```
updateCard(options, tokens, [callback])
```

Update a card by sourceItemId. The card is first requested; if it does not exist, a new one is inserted. This is useful when you want to send information that will always be updated to the device. If `options.isPinned` is not set, it defaults to true, meaning new cards will always be inserted unless one is pinned. `tokens` and `callback` are the same as above.

```
deleteBundle(options, tokens, [callback])
```

Deletes a bundle by `options.bundleId`

```
deleteCard(options, tokens, [callback])
```

Deletes a card by id

```
patchCard(options, tokens, [callback])
```

Updates a card by id

```
mirrorCall(call, tokens, callback)
```

Places a call to the Mirror API, authenticated with `token`. `call` is a function returned from `mirror`, which contains discovered functions, i.e.

```
mirrorCall(mirror.timeline.list({ "sourceItemId": options.sourceItemId,
		"isPinned": options.isPinned || true }), tokens, callback);
```

```
client_tokens
```

An array of the client OAuth tokens.

```
all
```

Any of the above methods can be called with exports.all, which runs the command on *all* client tokens, and accepts (options, callback) as the arguments. E.g.:

```
prism.all.updateCard({ html: html, isPinned: true, sourceItemId: "gtop_"+config.hostname });
```


## Examples

I built Prism so I could abstract out a lot of the code for my Mirror API projects, and as such have a few examples to share. More are welcome ;)

[gtop](https://github.com/jaxbot/gtop) - Server monitor
[Glass-Mint](https://github.com/jaxbot/glass-mint) - Mint.com banking information on Glass

## License
MIT

## Shameless plug

I do stuff with Google Glass, Node.js, and Vim plugins. [Follow me](https://github.com/jaxbot) if that sounds like something you're into (or you just want to make my day!)

