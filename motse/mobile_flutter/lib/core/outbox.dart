import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:sqflite/sqflite.dart';

import 'api_client.dart';

/// Offline outbox (P1, doc §8) — the client half of the replay protocol.
///
/// Mutations queue in SQLite with client UUIDs and per-aggregate
/// monotonic sequence numbers; replay posts the batch to
/// POST /v1/sync/outbox where the server guarantees exactly-once,
/// per-aggregate ordering, and reconciliation cards for true conflicts.
/// A queued letsema signup from a week in the bush lands exactly once.
class Outbox {
  Outbox(this._db, this._api) {
    _connectivity = Connectivity().onConnectivityChanged.listen((results) {
      if (!results.contains(ConnectivityResult.none)) flush();
    });
  }

  final Database _db;
  final ApiClient _api;
  StreamSubscription<List<ConnectivityResult>>? _connectivity;

  static Future<Outbox> open(ApiClient api, {String? path}) async {
    final db = await openDatabase(
      path ?? 'motse_outbox.db',
      version: 1,
      onCreate: (db, _) => db.execute('''
        CREATE TABLE outbox (
          id TEXT PRIMARY KEY,
          aggregate_ref TEXT NOT NULL,
          seq INTEGER NOT NULL,
          command TEXT NOT NULL,
          args TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'queued',
          conflict_card TEXT,
          created_at TEXT NOT NULL
        )
      '''),
    );
    return Outbox(db, api);
  }

  /// Queue a mutation; flushes immediately when online.
  Future<void> enqueue(String command, String aggregateRef, Map<String, dynamic> args) async {
    final seqRow = await _db.rawQuery(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM outbox WHERE aggregate_ref = ?',
        [aggregateRef]);
    await _db.insert('outbox', {
      'id': ApiClient.newIdempotencyKey(),
      'aggregate_ref': aggregateRef,
      'seq': seqRow.first['next'] as int,
      'command': command,
      'args': jsonEncode({...args, 'idempotency_key': ApiClient.newIdempotencyKey()}),
      'created_at': DateTime.now().toIso8601String(),
    });
    await flush();
  }

  /// Replay everything queued. Applied/duplicate/rejected outcomes are
  /// final; conflicts persist with their reconciliation card for the UI.
  Future<int> flush() async {
    final rows = await _db.query('outbox', where: "state = 'queued'", orderBy: 'seq');
    if (rows.isEmpty) return 0;
    final mutations = rows
        .map((row) => {
              'id': row['id'],
              'aggregate_ref': row['aggregate_ref'],
              'seq': row['seq'],
              'command': row['command'],
              'args': jsonDecode(row['args'] as String),
            })
        .toList();
    late Map response;
    try {
      response = await _api.post('/v1/sync/outbox', {'mutations': mutations}) as Map;
    } catch (_) {
      return 0; // stay queued; connectivity listener retries
    }
    var applied = 0;
    for (final outcome in response['outcomes'] as List) {
      final map = outcome as Map;
      final state = map['status'] as String;
      if (state == 'conflict') {
        await _db.update(
          'outbox',
          {'state': 'conflict', 'conflict_card': jsonEncode(map['card'])},
          where: 'id = ?',
          whereArgs: [map['id']],
        );
      } else {
        if (state == 'applied') applied += 1;
        await _db.delete('outbox', where: 'id = ?', whereArgs: [map['id']]);
      }
    }
    return applied;
  }

  /// Reconciliation cards awaiting the user (never silently resolved).
  Future<List<Map<String, dynamic>>> conflicts() async {
    final rows = await _db.query('outbox', where: "state = 'conflict'");
    return rows
        .map((row) => {
              'id': row['id'],
              'card': jsonDecode(row['conflict_card'] as String? ?? '{}'),
            })
        .toList();
  }

  /// User resolved a card: requeue with the chosen value or drop.
  Future<void> resolveConflict(String id, {bool retry = false}) async {
    if (retry) {
      await _db.update('outbox', {'state': 'queued', 'conflict_card': null},
          where: 'id = ?', whereArgs: [id]);
      await flush();
    } else {
      await _db.delete('outbox', where: 'id = ?', whereArgs: [id]);
    }
  }

  Future<int> depth() async {
    final rows = await _db.rawQuery("SELECT COUNT(*) AS n FROM outbox WHERE state = 'queued'");
    return rows.first['n'] as int;
  }

  Future<void> dispose() async {
    await _connectivity?.cancel();
    await _db.close();
  }
}
