## Configuration options

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

	"callbacks": {
		// called whenever a new subscription is received.  todo: use .on
		"subscription": function(err, { data: raw_data, item: timelineitem })
	}

}
```
