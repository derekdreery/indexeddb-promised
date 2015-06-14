var Q = require('q');
module.exports = function(dbName) {
  var version;
  var doUpgrade;
  var objectStores;

  var debug = false;

  this.setDebug = function() {
    debug = true;
    return this;
  };

  this.setVersion = function(pVersion) {
    version = pVersion;
    return this;
  };

  this.setDoUpgrade = function(pDoUpgrade) {
    doUpgrade = pDoUpgrade;
    return this;
  };

  this.addObjectStore = function(store) {
    if(!objectStores) {
      objectStores = [];
    }

    objectStores.push(store);
    return this;
  };

  this.build = function() {
    if(!doUpgrade) {
      doUpgrade = function(db) {
        objectStores.forEach(function(objStore) {
          var objectStore = db.createObjectStore(objStore.name, objStore.keyType);

          if(objStore.indexes) {
            objStore.indexes.forEach(function(index) {
              objectStore.createIndex(index.name, index.keyPath, index.options);
            });
          }
        });
      };
    }

    var indexeddb = new Indexeddb(dbName, version, doUpgrade);

    if(objectStores) {
      objectStores.forEach(function(store) {
        var objectStore = new ObjectStore(indexeddb.getDb(), store.name);
        indexeddb[store.name] = objectStore;

        if(store.indexes) {
          store.indexes.forEach(function(index) {
            indexeddb[store.name + 'By' + capitalize(index.name)] =
              new Index(indexeddb.getDb(), store.name, index.name);
          });
        }
      });
    }

    if(debug) {
      var global = Function('return this')();
      global['indexeddbPromised_'+dbName] = indexeddb;
    }

    return indexeddb;
  };

  function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  return this;
};

var ObjectStore = function(db, storeName) {
  this.db = db;
  this.storeName = storeName;

  return this;
}

ObjectStore.prototype.getStoreOrIndex = function(objectStore) {
  return objectStore;
};

ObjectStore.prototype.add = function(record, key) {
  var self = this;
  var deferTransaction = Q.defer();
  var deferAdd = Q.defer();
  var resultAdd;

  this.db.then(function(db) {
    return db.transaction(self.storeName, "readwrite");
  })
  .then(function(transaction) {
    transaction.oncomplete = function(event) {
      deferTransaction.resolve(resultAdd);
    };

    transaction.onerror = function(event) {
      defer.reject(event.target.errorCode);
    };

    var objectStore = transaction.objectStore(self.storeName);
    var storeOrIndex = self.getStoreOrIndex(objectStore);

    var request = storeOrIndex.add(record, key);
    request.onsuccess = function(event) {
      resultAdd = event.target.result;
      deferAdd.resolve(event.target.result);
    };

  });

  return deferTransaction.promise;
};

ObjectStore.prototype.get = function(key) {
  var self = this;
  var getDefer = Q.defer();

  return this.db.then(function(db) {
    var objectStore = db.transaction([self.storeName])
    .objectStore(self.storeName);
    var storeOrIndex = self.getStoreOrIndex(objectStore);

    var request = storeOrIndex.get(key);
    request.onerror = function(event) {
      getDefer.reject(event.target.errorCode);
    };
    request.onsuccess = function(event) {
      getDefer.resolve(event.target.result);
    };

    return getDefer.promise;
  });
};

ObjectStore.prototype.delete = function(key) {
  var self = this;
  var defer = Q.defer();

  return this.db.then(function(db) {
    var objectStore = db.transaction([self.storeName],
       'readwrite').objectStore(self.storeName);

    var storeOrIndex = self.getStoreOrIndex(objectStore);

    var request = storeOrIndex.delete(key);

    request.onerror = function(event) {
      defer.reject(event.target.errorCode);
    };
    request.onsuccess = function(event) {
      defer.resolve(event.target.result);
    };

    return defer.promise;
  });
};

ObjectStore.prototype.put = function(record, key) {
  var self = this;
  var deferTransaction = Q.defer();
  var deferPut = Q.defer();
  var resultPut;

  this.db.then(function(db) {
    return db.transaction(self.storeName, "readwrite");
  })
  .then(function(transaction) {
    transaction.oncomplete = function(event) {
      deferTransaction.resolve(resultPut);
    };

    transaction.onerror = function(event) {
      defer.reject(event.target.errorCode);
    };
    var objectStore = transaction.objectStore(self.storeName);
    var storeOrIndex = self.getStoreOrIndex(objectStore);

    var request = storeOrIndex.put(record, key);

    request.onsuccess = function(event) {
      resultPut = event.target.result;
      deferPut.resolve(event.target.result);
    };

  });

  return deferTransaction.promise;
};

ObjectStore.prototype.getAll = function() {
  var self = this;
  var defer = Q.defer();
  var result = [];

  this.db.then(function(db) {
    var transaction = db.transaction(self.storeName);
    var objectStore = transaction.objectStore(self.storeName);

    self.getStoreOrIndex(objectStore)
    .openCursor()
    .onsuccess = function(event) {
      var cursor = event.target.result;
      if(cursor) {
        result.push(cursor.value);
        cursor.continue();
      } else {
        defer.resolve(result);
      }
    };
  });

  return defer.promise;
};

ObjectStore.prototype.getAllKeys = function() {
  var self = this;
  var defer = Q.defer();
  var result = [];

  this.db.then(function(db) {
    var transaction = db.transaction(self.storeName);
    var objectStore = transaction.objectStore(self.storeName);

    self.getStoreOrIndex(objectStore)
    .openCursor()
    .onsuccess = function(event) {
      var cursor = event.target.result;
      if(cursor) {
        result.push(cursor.key);
        cursor.continue();
      } else {
        defer.resolve(result);
      }
    };
  });

  return defer.promise;
};

var Index = function(db, storeName, indexName) {

  ObjectStore.call(this, db, storeName);

  this.indexName = indexName;

  return this;
};

Index.prototype = Object.create(ObjectStore.prototype);
Index.prototype.getStoreOrIndex = function(objectStore) {
  return objectStore.index(this.indexName);
};
Index.prototype.constructor = Index;

var Indexeddb = function(dbName, version, doUpgrade) {
  var openDbDeferred = Q.defer();

  var db = openDbDeferred.promise;

  var request;

  if(version) {
    request = window.indexedDB.open(dbName, version);
  } else {
    request = window.indexedDB.open(dbName);
  }

  request.onupgradeneeded = function (event) {
    var db = event.target.result;
    if(doUpgrade) {
      doUpgrade(db);
    }
  };
  request.onerror = function(event) {
    openDbDeferred.reject(
      "Failed to open indexeddb: " + event.target.errorCode + ".");
  };
  request.onsuccess = function(event) {
    openDbDeferred.resolve(event.target.result);
  };

  this.getDb = function() {
    return db;
  };

  this.cleanup = function() {
    var cleanDB = function() {
      db.done();
      db = null
      return null;
    }
    return db.then(cleanDB);
  }

  this.execTransaction = function(operations, objectStores, mode) {

    var execute = function(db) {
      var queue = Q([]);
      var tx = db.transaction(objectStores, mode);

      operations.forEach(function(operation) {
        var deferred = Q.defer();
        queue = queue.then(function(resultsAccumulator) {
          resultsAccumulator.push(deferred.promise)
          return resultsAccumulator;
        });
        var request = operation(tx);

        if(!request) {
          deferred.resolve(null);
        } else if('onsuccess' in request && 'onerror' in request) {
          request.onsuccess = function(event) {
            //console.log('onsuccess: about to resolve '+operation.operationName+': result: '+JSON.stringify(event.target.result));
            deferred.resolve(event.target.result);
          };
          request.oncomplete = function(event) {
            //console.log('oncomplete: about to resolve '+operation.operationName+': result: '+JSON.stringify(event.target.result));
            deferred.resolve(event.target.result);
          };
          request.onerror = function(event) {
            deferred.reject(new Error('IndexedDB transaction error: ' + event.target.errorCode));
          };
        } else {
          //console.log('request is result: about to resolve '+operation.operationName+': result: '+JSON.stringify(request));
          deferred.resolve(request);
        }
      });

      return Q.all(queue);
    };

    return db
    .then(execute);
  };

  this.add = function(store, record, key) {
    var deferTransaction = Q.defer();
    var deferAdd = Q.defer();
    var resultAdd;

    db.then(function(db) {
      return db.transaction(store, "readwrite");
    })
    .then(function(transaction) {
      transaction.oncomplete = function(event) {
        deferTransaction.resolve(resultAdd);
      };

      transaction.onerror = function(event) {
        defer.reject(event.target.errorCode);
      };

      var objectStore = transaction.objectStore(store);

      var request = objectStore.add(record, key);
      request.onsuccess = function(event) {
        resultAdd = event.target.result;
        deferAdd.resolve(event.target.result);
      };

    });

    return deferTransaction.promise;
  };

  this.get = function(store, key) {
    var getDefer = Q.defer();

    return db.then(function(db) {
      var request = db.transaction([store]).objectStore(store).get(key);
      request.onerror = function(event) {
        getDefer.reject(event.target.errorCode);
      };
      request.onsuccess = function(event) {
        getDefer.resolve(event.target.result);
      };

      return getDefer.promise;
    });
  };

  this.delete = function(store, key) {
    var defer = Q.defer();

    return db.then(function(db) {
      var request = db.transaction([store], 'readwrite')
      .objectStore(store)
      .delete(key);

      request.onerror = function(event) {
        defer.reject(event.target.errorCode);
      };
      request.onsuccess = function(event) {
        defer.resolve(event.target.result);
      };

      return defer.promise;
    });
  };

  this.put = function(store, record, key) {
    var deferTransaction = Q.defer();
    var deferPut = Q.defer();
    var resultPut;

    db.then(function(db) {
      return db.transaction(store, "readwrite");
    })
    .then(function(transaction) {
      transaction.oncomplete = function(event) {
        deferTransaction.resolve(resultPut);
      };

      transaction.onerror = function(event) {
        defer.reject(event.target.errorCode);
      };

      var objectStore = transaction.objectStore(store);

      var request = objectStore.put(record, key);
      request.onsuccess = function(event) {
        resultPut = event.target.result;
        deferPut.resolve(event.target.result);
      };

    });

    return deferTransaction.promise;
  };

  this.getAll = function(store) {
    var defer = Q.defer();
    var result = [];

    db.then(function(db) {
      db.transaction(store)
      .objectStore(store)
      .openCursor()
      .onsuccess = function(event) {
        var cursor = event.target.result;
        if(cursor) {
          result.push(cursor.value);
          cursor.continue();
        } else {
          defer.resolve(result);
        }
      };
    });

    return defer.promise;
  };

  this.getAllKeys = function(store) {
    var defer = Q.defer();
    var result = [];

    db.then(function(db) {
      db.transaction(store)
      .objectStore(store)
      .openCursor()
      .onsuccess = function(event) {
        var cursor = event.target.result;
        if(cursor) {
          result.push(cursor.key);
          cursor.continue();
        } else {
          defer.resolve(result);
        }
      };
    });

    return defer.promise;
  };

  return this;
}
