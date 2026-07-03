import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../main.dart';

/// More: Puo (lessons + progress), Wallet, Notifications, Identity
/// (verification status, trusted devices), and sync status (WS1).
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(children: [
        _nav(context, Icons.school_outlined, 'Puo — Lessons & progress', const PuoScreen()),
        _nav(context, Icons.account_balance_wallet_outlined, 'Wallet & receipts', const WalletScreen()),
        _nav(context, Icons.notifications_outlined, 'Notifications', const NotificationsScreen()),
        _nav(context, Icons.verified_user_outlined, 'Identity & devices', const IdentityScreen()),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.sync_outlined),
          title: const Text('Sync queued actions now'),
          onTap: () async {
            final applied = await app.outbox?.flush() ?? 0;
            if (context.mounted) {
              ScaffoldMessenger.of(context)
                  .showSnackBar(SnackBar(content: Text('Synced $applied queued action(s)')));
            }
          },
        ),
        ListTile(
          leading: const Icon(Icons.logout, color: MotseTheme.bad),
          title: const Text('Sign out'),
          onTap: () => app.signOut(),
        ),
      ]),
    );
  }

  Widget _nav(BuildContext context, IconData icon, String title, Widget screen) => ListTile(
        leading: Icon(icon),
        title: Text(title),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => screen)),
      );
}

class PuoScreen extends StatefulWidget {
  const PuoScreen({super.key});

  @override
  State<PuoScreen> createState() => _PuoScreenState();
}

class _PuoScreenState extends State<PuoScreen> {
  List<Map> _courses = [];
  Map? _progress;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AppState>().api;
    final results = await Future.wait([api.get('/v1/puo/courses'), api.get('/v1/puo/progress')]);
    setState(() {
      _courses = (results[0] as List).cast<Map>();
      _progress = results[1] as Map;
    });
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>().api;
    return Scaffold(
      appBar: AppBar(title: const Text('Puo — Language')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        if (_progress != null)
          Card(
            child: ListTile(
              title: const Text('My progress'),
              subtitle: Text('${_progress!['completed_lessons']} lessons completed'),
            ),
          ),
        for (final course in _courses)
          Card(
            child: Column(children: [
              ListTile(
                title: Text(course['title'] as String),
                subtitle: Text('${course['language']} · ${course['level']} · '
                    '${(course['lesson_refs'] as List).length} lesson(s)'),
              ),
              OverflowBar(children: [
                for (final lesson in (course['lesson_refs'] as List).cast<String>())
                  TextButton(
                    onPressed: () async {
                      await api.post('/v1/puo/lessons/$lesson/complete', {});
                      await _load();
                    },
                    child: const Text('Complete lesson'),
                  ),
              ]),
            ]),
          ),
      ]),
    );
  }
}

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  List<Map> _accounts = [];
  List<Map> _history = [];
  List<Map> _payouts = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AppState>().api;
    final results = await Future.wait([
      api.get('/v1/wallet/accounts'),
      api.get('/v1/wallet/history'),
      api.get('/v1/wallet/payouts'),
    ]);
    setState(() {
      _accounts = (results[0] as List).cast<Map>();
      _history = (results[1] as List).cast<Map>();
      _payouts = (results[2] as List).cast<Map>();
    });
  }

  String _bwp(num minor) => 'BWP ${(minor / 100).toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Wallet')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        for (final account in _accounts)
          Card(
            child: ListTile(
              title: Text(account['type'] as String),
              subtitle: Text(account['id'] as String, style: const TextStyle(fontSize: 11)),
              trailing: Text(_bwp(account['balance_minor'] as num),
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
          ),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text('Receipts', style: TextStyle(fontWeight: FontWeight.w600)),
        ),
        for (final posting in _history)
          Card(
            child: ListTile(
              dense: true,
              title: Text(posting['purpose'] as String),
              subtitle: Text('${posting['ref']} · ${(posting['ts'] as String).substring(0, 16)}',
                  style: const TextStyle(fontSize: 11)),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  for (final entry in (posting['my_entries'] as List).cast<Map>())
                    Text(
                      '${(entry['amount_minor'] as num) > 0 ? '+' : ''}${_bwp(entry['amount_minor'] as num)}',
                      style: TextStyle(
                        color: (entry['amount_minor'] as num) > 0 ? MotseTheme.ok : MotseTheme.text,
                      ),
                    ),
                ],
              ),
            ),
          ),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text('Payouts', style: TextStyle(fontWeight: FontWeight.w600)),
        ),
        for (final payout in _payouts)
          Card(
            child: ListTile(
              dense: true,
              title: Text(_bwp(payout['amount_minor'] as num)),
              subtitle: Text(payout['state'] as String),
            ),
          ),
      ]),
    );
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map> _items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AppState>().api;
    final out = await api.get('/v1/notifications?page_size=30') as Map;
    setState(() => _items = (out['items'] as List).cast<Map>());
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>().api;
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), children: [
          for (final n in _items)
            Card(
              child: ListTile(
                leading: Icon(
                  n['read'] == true ? Icons.notifications_none : Icons.notifications_active,
                  color: n['read'] == true ? MotseTheme.dim : MotseTheme.warn,
                ),
                title: Text(n['title'] as String? ?? ''),
                subtitle: Text('${n['body'] ?? ''} · ${n['category']}'),
                onTap: n['read'] == true
                    ? null
                    : () async {
                        await api.post('/v1/notifications/${n['id']}/read', {});
                        await _load();
                      },
              ),
            ),
        ]),
      ),
    );
  }
}

class IdentityScreen extends StatelessWidget {
  const IdentityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final user = app.user ?? {};
    return Scaffold(
      appBar: AppBar(title: const Text('Identity & devices')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        Card(
          child: ListTile(
            title: const Text('Verification level'),
            subtitle: const Text(
                'L1: phone verified · L2: ward endorsement by your headman\'s office · '
                'L3: institutional (documents verified)'),
            trailing: Chip(label: Text(user['level'] as String? ?? 'L1')),
          ),
        ),
        Card(
          child: ListTile(
            title: const Text('Request ward verification (L2)'),
            subtitle: const Text('Visit your kgotla — the headman\'s office endorses you in-app. '
                'Supporting documents upload as media attachments to your request.'),
            trailing: const Icon(Icons.upload_file_outlined),
            onTap: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Endorsements are recorded at your kgotla (§5.1)')),
            ),
          ),
        ),
        Card(
          child: ListTile(
            title: const Text('Trusted devices'),
            subtitle: Text('This device: bound to your session · '
                'ward: ${user['ward_ref'] ?? 'not yet endorsed'}'),
          ),
        ),
        Card(
          child: ListTile(
            title: const Text('Approval history'),
            subtitle: const Text('Every verification action is on your tamper-evident audit chain, '
                'visible to you and reviewable at your kgotla.'),
          ),
        ),
      ]),
    );
  }
}
