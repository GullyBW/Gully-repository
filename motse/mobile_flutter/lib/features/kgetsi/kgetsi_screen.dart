import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../main.dart';

/// Kgetsi (WS1): contributions/donations, milestone tracking, escrow
/// status, transparency ledger. Contributions ride the offline outbox —
/// giving works in a dead zone and lands exactly once (§8).
class KgetsiScreen extends StatefulWidget {
  const KgetsiScreen({super.key});

  @override
  State<KgetsiScreen> createState() => _KgetsiScreenState();
}

class _KgetsiScreenState extends State<KgetsiScreen> {
  List<Map> _campaigns = [];
  final Map<String, Map> _ledgers = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AppState>().api;
    final out = await api.get('/v1/kgetsi/campaigns?page_size=20') as Map;
    setState(() => _campaigns = (out['items'] as List).cast<Map>());
  }

  Future<void> _give(Map campaign) async {
    final app = context.read<AppState>();
    final controller = TextEditingController();
    final pula = await showDialog<num>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Give to "${campaign['title']}"'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(hintText: 'Amount in Pula'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, num.tryParse(controller.text)),
            child: const Text('Give'),
          ),
        ],
      ),
    );
    if (pula == null || pula <= 0) return;
    // Privileged action → biometric re-auth (§5.3 shared devices).
    if (!await app.session.reauthenticate('Confirm your contribution')) return;
    final accounts = (await app.api.get('/v1/wallet/accounts') as List).cast<Map>();
    final wallet = accounts.where((a) => a['type'] == 'user_wallet').firstOrNull;
    if (wallet == null || !mounted) return;
    await app.outbox!.enqueue('kgetsi.contribute', 'campaign:${campaign['id']}', {
      'campaign_id': campaign['id'],
      'source_account_id': wallet['id'],
      'amount_minor': (pula * 100).round(),
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Contribution queued — syncs the moment you are online')),
      );
    }
  }

  Future<void> _toggleLedger(Map campaign) async {
    final id = campaign['id'] as String;
    if (_ledgers.containsKey(id)) {
      setState(() => _ledgers.remove(id));
      return;
    }
    final api = context.read<AppState>().api;
    final ledger = await api.get('/v1/public/campaigns/$id/ledger') as Map;
    setState(() => _ledgers[id] = ledger);
  }

  String _bwp(num minor) => 'BWP ${(minor / 100).toStringAsFixed(2)}';

  double _milestoneProgress(String state) => switch (state) {
        'released' || 'receipted' => 1.0,
        'approved' => 0.7,
        'evidence_submitted' => 0.4,
        _ => 0.1,
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Kgetsi — Campaigns')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            for (final campaign in _campaigns)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(
                        child: Text(campaign['title'] as String,
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                      Chip(label: Text(campaign['state'] as String)),
                    ]),
                    Text('${campaign['class']} · target ${_bwp(campaign['target_minor'] as num)}',
                        style: const TextStyle(color: MotseTheme.dim, fontSize: 13)),
                    Row(children: [
                      FilledButton(onPressed: () => _give(campaign), child: const Text('Give')),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: () => _toggleLedger(campaign),
                        child: const Text('Transparency ledger'),
                      ),
                    ]),
                    if (_ledgers[campaign['id']] != null) ...[
                      const Divider(),
                      Text(
                        'funded ${_bwp(_ledgers[campaign['id']]!['funded_minor'] as num)} · '
                        'released ${_bwp(_ledgers[campaign['id']]!['released_minor'] as num)}',
                        style: const TextStyle(color: MotseTheme.dim, fontSize: 13),
                      ),
                      for (final ms in (_ledgers[campaign['id']]!['milestones'] as List).cast<Map>())
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${ms['description']} — ${ms['state']} (${ms['approvals']}/2 approvals)',
                                style: const TextStyle(fontSize: 13)),
                            LinearProgressIndicator(value: _milestoneProgress(ms['state'] as String)),
                          ]),
                        ),
                    ],
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
