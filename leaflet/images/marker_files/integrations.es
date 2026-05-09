(function(FS) {
  var session = FS.getCurrentSession(), sessionUrl = FS.getCurrentSessionURL();
  function retryWithBackoff(condition, callback, maxWait, failureMsg, timeoutCallback) {
    var totalTimeExpired = 0;
    var wait = 64;
    var resultFn = function() {
      if (condition()) {
        callback();
        return;
      }
      wait = Math.min(wait * 2, 1024);
      if (totalTimeExpired > maxWait) {
        FS.log('warn', failureMsg);
        !!timeoutCallback && timeoutCallback(failureMsg);
        return;
      }
      totalTimeExpired += wait
      setTimeout(resultFn, wait);
    };
    return resultFn;
  }
  function loadSession(key) {
	var lastSession = window['localStorage'].getItem(key);
    if (!lastSession) {
      lastSession = FS._cookies()[key];
    }
    return lastSession
  }
  function saveSession(key, session) {
    window['localStorage'].setItem(key, session);
  }

	window['_dlo_appender'] = 'fullstory';
	window['_dlo_telemetryExporter'] = (function(FS) {
		const eventNameMap = {
			dlo_init_span: 'INIT_DURATION',
			dlo_rule_registration_span: 'RULE_REGISTRATION_DURATION',
			dlo_handle_event_span: 'HANDLE_EVENT_DURATION',
			dlo_client_error: 'CLIENT_ERROR_COUNT',
		};

		function sendEvent(evt, value) {
			const metricName = eventNameMap[evt.name];
			if (!metricName) {
				return;
			}
			const eventStatus = evt.name === 'dlo_client_error' ? 'FAILURE' : 'SUCCESS';
			const metadata = evt.attributes || {};
			metadata.name = metricName;
			metadata.value = value;
			FS('stat', {
				eventType: 'INTEGRATION_METRIC',
				payload: {
					provider_id: 'dlo',
					org_id: window['_fs_org'],
					event_status: eventStatus,
					metadata: metadata,
				},
			});
		}

		return {
			sendSpan: function(spanEvent) {
				sendEvent(spanEvent, spanEvent.duration.toString());
			},
			sendCount: function(countEvent) {
				sendEvent(countEvent, countEvent.value.toString());
			},
		};
	}(FS));
	window['_dlo_logLevel'] = -1;
	window['_dlo_beforeDestination'] = Array.isArray(window['_dlo_beforeDestination']) ? window['_dlo_beforeDestination'] : [{ name: 'convert', enumerate: true, preserveArray: true, index: -1 },{ name: 'suffix' },{ name: 'insert', value: 'dlo', position: -1 }];
	window['_dlo_previewMode'] = false;
	window['_dlo_readOnLoad'] = false;
	window['_dlo_validateRules'] = true;

	window['_dlo_rules_adobe_am'] = [];
	window['_dlo_rules_ceddl'] = [];
	window['_dlo_rules_google_ec'] = [];
	window['_dlo_rules_google_ec_ga4'] = [];
	window['_dlo_rules_google_em'] = [];
	window['_dlo_rules_google_em_ga4'] = [];
	window['_dlo_rules_tealium_retail'] = [];
	try {
		window['_dlo_rules_custom'] = [
    {
        "id": "fs-ga-revenue-event",
        "source": "dataLayer",
        "operators": [
        { "name": "query", "select": "$[?(event=Order Completed)]" },
        { "name": "query", "select": "$[(event,userId,segmentAnonymousId,orderType,order_id,subtotal,total,revenue,currency,products)]" },
        { "name": "insert", "select": "event" }
        ],
        "destination": "FS.event",
        "readOnLoad": true,
        "monitor": true
    }
];
	} catch (err) {
		console.error('FullStory custom rules error; review DLO integration\'s custom rules.');
	}
	
	var dloScriptTag = document.createElement('script');
	dloScriptTag.type = 'text/javascript';
	dloScriptTag.async = true;
	var recSettingsHost = window['_fs_rec_settings_host'];
	var host = typeof recSettingsHost === 'string' ? recSettingsHost : 'edge.fullstory.com';
	dloScriptTag.src = 'https://' + host + '/datalayer/v4/latest.js';
	var firstScriptTag = document.getElementsByTagName('script')[0];
	firstScriptTag.parentNode.insertBefore(dloScriptTag,firstScriptTag);
	
})(window['_fs_namespace'] ? window[window['_fs_namespace']] : window['FS'])