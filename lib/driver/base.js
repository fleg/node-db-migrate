var util = require('util');
var events = require('events');
var type = require('../data_type');
var log = require('../log');
var Class = require('../class');
var Promise = require('bluebird');

var internals = {};

module.exports = Base = Class.extend({
  init: function(intern) {
    internals = intern;
    this.eventEmmiter = new events.EventEmitter();
    for(var n in events.EventEmitter.prototype) {
      this[n] = events.EventEmitter.prototype[n];
    }
  },

  close: function() {
    throw new Error('not yet implemented');
  },

  mapDataType: function(str) {
    switch(str) {
      case type.STRING:
        return 'VARCHAR';
      case type.TEXT:
        return 'TEXT';
      case type.INTEGER:
        return 'INTEGER';
      case type.BIG_INTEGER:
        return 'BIGINT';
      case type.DATE_TIME:
        return 'INTEGER';
      case type.REAL:
        return 'REAL';
      case type.BLOB:
        return 'BLOB';
      case type.TIMESTAMP:
        return 'TIMESTAMP';
      case type.BINARY:
        return 'BINARY';
      case type.BOOLEAN:
        return 'BOOLEAN';
      case type.DECIMAL:
        return 'DECIMAL';
      case type.CHAR:
        return 'CHAR';
      case type.DATE:
        return 'DATE';
      case type.SMALLINT:
        return 'SMALLINT';
      default:
        var unknownType = str.toUpperCase();
        log.warn('Using unknown data type', unknownType);
        return unknownType;
    }
  },

  createDatabase: function() {

    throw new Error('not implemented');
  },

  switchDatabase: function() {
    throw new Error('not implemented');
  },

  dropDatabase: function() {
    throw new Error('not implemented');
  },

  recurseCallbackArray: function(foreignKeys, callback)
  {
    var self = this;

    if (foreignKeys.length > 0)
      (foreignKeys.pop())(function() { self.recurseCallbackArray(foreignKeys, callback); } );
    else
      callback();
  },

  bindForeignKey: function(tableName, columnName, fkOptions) {
    var self = this,
        mapping = {};

    if(typeof(fkOptions.mapping) === 'string')
      mapping[columnName] = fkOptions.mapping;
    else
      mapping = fkOptions.mapping;

    return function (callback) { self.addForeignKey(tableName, fkOptions.table,
        fkOptions.name, mapping, fkOptions.rules, callback); };
  },

  createColumnDef: function(name, spec, options) {
    name = '"' + name + '"';
    var type       = this.mapDataType(spec.type);
    var len        = spec.length ? util.format('(%s)', spec.length) : '';
    var constraint = this.createColumnConstraint(spec, options);

    return { foreignKey: null,
                 constraints: [name, type, len, constraint].join(' ') };
  },

  createMigrationsTable: function(callback) {
    var options = {
      columns: {
        'id': { type: type.INTEGER, notNull: true, primaryKey: true, autoIncrement: true },
        'name': { type: type.STRING, length: 255, notNull: true},
        'run_on': { type: type.DATE_TIME, notNull: true}
      },
      ifNotExists: true
    };
    this.createTable(internals.migrationTable, options, callback);
  },

  createTable: function(tableName, options, callback) {
    log.verbose('creating table:', tableName);
    var columnSpecs = options;
    var tableOptions = {};

    if (options.columns !== undefined) {
      columnSpecs = options.columns;
      delete options.columns;
      tableOptions = options;
    }

    var ifNotExistsSql = "";
    if(tableOptions.ifNotExists) {
      ifNotExistsSql = "IF NOT EXISTS";
    }

    var primaryKeyColumns = [];
    var columnDefOptions = {
      emitPrimaryKey: false
    };

    for (var columnName in columnSpecs) {
      var columnSpec = this.normalizeColumnSpec(columnSpecs[columnName]);
      columnSpecs[columnName] = columnSpec;
      if (columnSpec.primaryKey) {
        primaryKeyColumns.push(columnName);
      }
    }

    var pkSql = '';
    if (primaryKeyColumns.length > 1) {
      pkSql = util.format(', PRIMARY KEY (%s)', this.quoteArr(primaryKeyColumns).join(', '));
    } else {
      columnDefOptions.emitPrimaryKey = true;
    }

    var columnDefs = [];
    var foreignKeys = [];

    for (var columnName in columnSpecs) {
      var columnSpec = columnSpecs[columnName];
      var constraint = this.createColumnDef(columnName, columnSpec, columnDefOptions, tableName);

      columnDefs.push(constraint.constraints);
      if (constraint.foreignKey)
        foreignKeys.push(constraint.foreignKey);
    }

    var sql = util.format('CREATE TABLE %s "%s" (%s%s)', ifNotExistsSql, tableName, columnDefs.join(', '), pkSql);

    this.runSql(sql, function()
    {

        this.recurseCallbackArray(foreignKeys, callback);
    }.bind(this));
  },

  dropTable: function(tableName, options, callback) {

    if (arguments.length < 3) {
      callback = options;
      options = {};
    }

    var ifExistsSql = '';
    if (options.ifExists) {
      ifExistsSql = 'IF EXISTS';
    }
    var sql = util.format('DROP TABLE %s "%s"', ifExistsSql, tableName);
    this.runSql(sql, callback);
  },

  renameTable: function(tableName, newTableName, callback) {
    throw new Error('not yet implemented');
  },

  addColumn: function(tableName, columnName, columnSpec, callback) {

    var def = this.createColumnDef(columnName, this.normalizeColumnSpec(columnSpec, tableName));
    var sql = util.format('ALTER TABLE "%s" ADD COLUMN %s', tableName, def.constraints);

    this.runSql(sql, function()
    {
      if(def.foreignKey)
        def.foreignKey(callback);
      else
        callback();
    });
  },

  removeColumn: function(tableName, columnName, callback) {
    throw new Error('not yet implemented');
  },

  renameColumn: function(tableName, oldColumnName, newColumnName, callback) {
    throw new Error('not yet implemented');
  },

  changeColumn: function(tableName, columnName, columnSpec, callback) {
    throw new Error('not yet implemented');
  },

  quoteArr: function(arr) {

      for(var i = 0; i < arr.length; ++i)
        arr[i] = '"' + arr[i] + '"';

      return arr;
  },

  addIndex: function(tableName, indexName, columns, unique, callback) {
    if (typeof(unique) === 'function') {
      callback = unique;
      unique = false;
    }

    if (!Array.isArray(columns)) {
      columns = [columns];
    }
    var sql = util.format('CREATE %s INDEX "%s" ON "%s" (%s)', (unique ? 'UNIQUE' : ''),
      indexName, tableName, this.quoteArr(columns).join(', '));

    this.runSql(sql, callback);
  },

  insert: function(tableName, columnNameArray, valueArray, callback) {
    if (columnNameArray.length !== valueArray.length) {
      return callback(new Error('The number of columns does not match the number of values.'));
    }

    var sql = util.format('INSERT INTO "%s" ', tableName);
    var columnNames = '(';
    var values = 'VALUES (';

    for (var index in columnNameArray) {
      columnNames += columnNameArray[index];

      if (typeof(valueArray[index]) === 'string') {
        values += "'" + this.escape(valueArray[index]) + "'";
      } else {
        values += valueArray[index];
      }

      if (index != columnNameArray.length - 1) {
       columnNames += ",";
       values +=  ",";
      }
    }

    sql += columnNames + ') '+ values + ');';
    this.runSql(sql, callback);
  },

  removeIndex: function(tableName, indexName, callback) {
    if (arguments.length === 2 && typeof(indexName) === 'function') {
      callback = indexName;
      indexName = tableName;
    } else if (arguments.length === 1 && typeof(tableName) === 'string') {
      indexName = tableName;
    }

    var sql = util.format('DROP INDEX "%s"', indexName);
    this.runSql(sql, callback);
  },

  addForeignKey: function() {
    throw new Error('not implemented');
  },

  removeForeignKey: function() {
    throw new Error('not implemented');
  },

  normalizeColumnSpec: function(obj) {
    if (typeof(obj) === 'string') {
      return { type: obj };
    } else {
      return obj;
    }
  },

  addMigrationRecord: function (name, callback) {
    this.runSql('INSERT INTO "' + internals.migrationTable + '" (name, run_on) VALUES (?, ?)', [name, new Date()], callback);
  },

  startMigration: function(cb){ return Promise.resolve().nodeify(cb); },
  endMigration: function(cb){ return Promise.resolve().nodeify(cb); },
  // sql, params, callback
  // sql, callback
  runSql: function() {
    throw new Error('not implemented');
  },

  /**
    * Queries the migrations table
    *
    * @param callback
    */
  allLoadedMigrations: function(callback) {
    var sql = 'SELECT * FROM "' + internals.migrationTable + '" ORDER BY run_on DESC, name DESC';
    return this.all(sql, callback);
  },

  /**
    * Deletes a migration
    *
    * @param migrationName   - The name of the migration to be deleted
    */
  deleteMigration: function(migrationName, callback) {
    var sql = 'DELETE FROM "' + internals.migrationTable + '" WHERE name = ?';
    this.runSql(sql, [migrationName], callback);
  },

  all: function(sql, params, callback) {
    throw new Error('not implemented');
  },

  escape: function(str) {
    return str.replace(/'/g, "''");
  }
});
