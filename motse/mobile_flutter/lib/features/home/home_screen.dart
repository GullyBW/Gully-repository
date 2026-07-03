import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../main.dart';

/// Home dashboard (WS1): profile, verification level, wallet summary,
/// notifications, community campaigns, heritage highlights, escrows.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = context.read<AppState>();
    try {
      final results = await Future.wait([
        app.api.get('/v1/wallet/accounts'),
        app.api.get('/v1/notifications?page_size=5'),
        app.api.get('/v1/kgetsi/campaigns?page_size=3'),
        app.api.get('/v1/heritage/search?page_size=3'),
      ]);
      setState(() => _data = {
            'accounts': results[0],
            'notifications': results[1],
            'campaigns': results[2],
            'heritage': results[3],
          });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  String _bwp(num minor) => 'BWP ${(minor / 100).toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final user = app.user ?? {};
    if (_error != null) return Center(child: Text(_error!));
    if (_data == null) return const Center(child: CircularProgressIndicator());

    final accounts = (_data!['accounts'] as List).cast<Map>();
    final balance = accounts.fold<num>(0, (s, a) => s + (a['balance_minor'] as num));
    final notifications = ((_data!['notifications'] as Map)['items'] as List).cast<Map>();
    final campaigns = ((_data!['campaigns'] as Map)['items'] as List).cast<Map>();
    final heritage = ((_data!['heritage'] as Map)['items'] as List).cast<Map>();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(children: [
            const CircleAvatar(child: Icon(Icons.person_outline)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(user['display_name'] as String? ?? 'Motse member',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                Text('Verification: ${user['level'] ?? 'L1'}',
                    style: const TextStyle(color: MotseTheme.dim, fontSize: 13)),
              ]),
            ),
            Chip(label: Text(user['level'] as String? ?? 'L1')),
          ]),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              title: const Text('Wallet'),
              subtitle: Text('${accounts.length} account(s)'),
              trailing: Text(_bwp(balance),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ),
          ),
          Card(
            child: Column(children: [
              const ListTile(title: Text('Notifications')),
              if (notifications.isEmpty)
                const ListTile(dense: true, title: Text('All caught up.', style: TextStyle(color: MotseTheme.dim))),
              for (final n in notifications)
                ListTile(
                  dense: true,
                  leading: Icon(
                    n['read'] == true ? Icons.notifications_none : Icons.notifications_active,
                    color: n['read'] == true ? MotseTheme.dim : MotseTheme.warn,
                  ),
                  title: Text(n['title'] as String? ?? ''),
                  subtitle: n['body'] != null ? Text(n['body'] as String) : null,
                ),
            ]),
          ),
          Card(
            child: Column(children: [
              const ListTile(title: Text('Community campaigns')),
              for (final c in campaigns)
                ListTile(
                  dense: true,
                  title: Text(c['title'] as String? ?? ''),
                  subtitle: Text('${c['class']} · ${c['state']}'),
                  trailing: Text(_bwp(c['target_minor'] as num)),
                ),
            ]),
          ),
          Card(
            child: Column(children: [
              const ListTile(title: Text('Heritage highlights')),
              for (final h in heritage)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.multitrack_audio, color: MotseTheme.accent),
                  title: Text(h['title'] as String? ?? h['id'] as String),
                ),
            ]),
          ),
        ],
      ),
    );
  }
}
