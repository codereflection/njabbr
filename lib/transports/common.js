(function(exports) {

  var httpUtils = require('../httpUtil'),
      ConnectionState = require('../connectionstate').ConnectionState,
      events = require('../signalr.events'),
      util = require('util'),
      qs = require('querystring');

  var checkIfAlive = function(connection) {
    var keepAliveData = connection.keepAliveData,
        diff,
        timeElapsed;

    if (connection.state === ConnectionState.connected) {
      diff = new Date();
      diff.setTime(diff - keepAliveData.lastKeepAlive);
      timeElapsed = diff.getTime();
      if (timeElapsed >= keepAliveData.timeout) {
        connection.log("Keep alive timed out.  Notifying transport that connection has been lost.");
        connection.transport.lostConnection(connection);
      } else if (timeElapsed >= keepAliveData.timeoutWarning) {
        if (!keepAliveData.userNotified) {
          connection.log("Keep alive has been missed, connection may be dead/slow.");
          connection.emit(events.onConnectionSlow);
          keepAliveData.userNotified = true;
        }
      } else {
        keepAliveData.userNotified = false;
      }
    }

    if (keepAliveData.monitoring) {
      setTimeout(function() {
        checkIfAlive(connection);
      }, keepAliveData.checkInterval);
    }
  };

  exports.TransportLogic = {
    addQs: function(url, connection) {
      if (!connection.qs) {
        return url;
      }
      if (typeof(connection.qs) === "object") {

      }
      if (typeof(connection.qs) === "string") {
        return url + "&" + connection.qs;
      }
      return url + "&" + escape(connection.qs.toString());
    },
    processMessages: function(connection, minData) {
      var data;
      if (connection.transport) {
        if (connection.transport.supportsKeepAlive && 
            connection.keepAliveData.activated) {
              this.updateKeepAlive(connection);
            }

        if (!minData) {
          return;
        }

        data = this.maximizePersistentResponse(minData);
        if (data.Disconnect) {
          connection.log("Disconnect command received from server");
          connection.stop(false, false);
          return;
        }
      }
    },
    maximizePersistentResponse: function(minPersistentResponse) {
      return {
        MessageId: minPersistentResponse.C,
        Messages: minPersistentResponse.M,
        Disconnect: typeof(minPersistentResponse.D) !== "undefined" ? true : false,
        TimedOut: typeof(minPersistentResponse.T) !== "undefined" ? true : false,
        LongPollDelay: minPersistentResponse.L,
        ResetGroups: minPersistentResponse.R,
        AddedGroups: minPersistentResponse.G,
        RemovedGroups: minPersistentResponse.g
      }
    },
    monitorKeepAlive: function(connection) {
      var keepAliveData = connection.keepAliveData,
          that = this;
      if (!keepAliveData.monitoring) {
        keepAliveData.monitoring = true;
        that.updateKeepAlive(connection);

        connection.keepAliveData.reconnectKeepAliveUpdate = function () {
          that.updateKeepAlive(connection);
        };

        connection.log("Now monitoring keep alive with a warning timeout of " + keepAliveData.timeoutWarning +
                        " and a connection lost timeout of " + keepAliveData.timeout);
        checkIfAlive(connection);
      } else {
        connection.log("Tried to monitor keep alive but it's already being monitored");
      }
    },
    stopMonitoringKeepAlive: function(connection) {
    },
    updateKeepAlive: function(connection) {
      connection.keepAliveData.lastKeepAlive = new Date();
    },
    getUrl: function(connection, transport, reconnecting, appendReconnectUrl) {
      var baseUrl = transport == "webSockets" ? "" : connection.baseUrl,
          url = baseUrl + connection.appRelativeUrl,
          qs = "transport=" + transport + "&connectionId=" + escape(connection.id);

      if (connection.data) {
        qs += "&connectionData=" + escape(connection.data);
      }

      if (!reconnecting) {
        url = url + "/connect";
      } else {
        if (appendReconnectUrl) {
          url = url + "/reconnect";
        }
        if (connection.messageId) {
          qs += "&messageId=" + connection.messageId;
        }
        if (connection.groups) {
          qs += "&groups=" + escape(JSON.stringify(connection.groups));
        }
      }
      url += "?" + qs;
      url = this.addQs(url, connection);
      url += "&tid=" + Math.floor(Math.random() * 11);
      return url;
    },
    send: function(connection, data) {
      var url = connection.url + "/send" + "?transport=" + connection.transport.name + "&connectionId=" + escape(connection.id);
      url = this.addQs(url, connection);
      // we send the data as form data,
      // but the requests library doesnt handle
      // serializing the data as a querystring
      // so we have to do that manually :-/
      data = qs.stringify({ data: data });
      connection.log("Sending " + data + " to " + url);
      httpUtils.post(url, data, function(result) {
        connection.log("Received result " + util.inspect(result));
        debugger;
        if (result) {
          connection.log("emitting on received");
          connection.emit(events.onReceived, result);
        }
      }, function(error) {
          connection.log("Error: " + error);
          connection.emit(events.onError, error);
      });
    },
    abort: function(connection, async) {
      if (typeof(connection.transport) === "undefined") {
        return;
      }

      async = typeof(async) === "undefined" ? true : async;
      var url = connection.url + "/abort" + "?transport=" + connection.transport.name + "&connectionId=" + escape(connection.id);
      url = this.addQs(url, connection);
      httpUtils.post(url, {});
      connection.log("Fired ajax abort async = " + async);
    }
  };
})(module.exports)