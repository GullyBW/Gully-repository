import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../main.dart';

/// Lelapa (WS1): family circles, tree, invitations, relationships,
/// family events. Trees and events are members-only server-side.
class LelapaScreen extends StatefulWidget {
  const LelapaScreen({super.key});

  @override
  State<LelapaScreen> createState() => _LelapaScreenState();
}

class _LelapaScreenState extends State<LelapaScreen> {
  List<Map> _circles = [];
  final Map<String, Map> _trees = {};
  final Map<String, List<Map>> _events = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AppState>().api;
    final circles = await api.get('/v1/lelapa/circles') as List;
    setState(() => _circles = circles.cast<Map>());
  }

  Future<void> _create() async {
    final name = await _promptText('New circle name');
    if (name == null || name.isEmpty) return;
    await context.read<AppState>().api.post('/v1/lelapa/circles', {'name': name});
    await _load();
  }

  Future<void> _invite(Map circle) async {
    final api = context.read<AppState>().api;
    final msisdn = await _promptText('Phone number to invite');
    if (msisdn == null) return;
    final relation = await _promptText('Relation (e.g. mother, rremogolo)');
    await api.post('/v1/lelapa/circles/${circle['id']}/invitations', {
      'msisdn': msisdn,
      'relation': relation,
    });
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Invitation sent')));
    }
  }

  Future<void> _toggleTree(Map circle) async {
    final id = circle['id'] as String;
    if (_trees.containsKey(id)) {
      setState(() => _trees.remove(id));
      return;
    }
    final tree = await context.read<AppState>().api.get('/v1/lelapa/circles/$id/tree') as Map;
    setState(() => _trees[id] = tree);
  }

  Future<void> _toggleEvents(Map circle) async {
    final id = circle['id'] as String;
    if (_events.containsKey(id)) {
      setState(() => _events.remove(id));
      return;
    }
    final events = await context.read<AppState>().api.get('/v1/lelapa/circles/$id/events') as List;
    setState(() => _events[id] = events.cast<Map>());
  }

  Future<String?> _promptText(String title) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, controller.text), child: const Text('OK')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lelapa — Family'),
        actions: [IconButton(onPressed: _create, icon: const Icon(Icons.add))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            if (_circles.isEmpty)
              const Card(
                child: ListTile(title: Text('Create your first family circle with +')),
              ),
            for (final circle in _circles)
              Card(
                child: Column(children: [
                  ListTile(
                    title: Text(circle['name'] as String),
                    subtitle: Text('${(circle['members'] as List).length} member(s)'),
                  ),
                  OverflowBar(children: [
                    TextButton(onPressed: () => _toggleTree(circle), child: const Text('Tree')),
                    TextButton(onPressed: () => _invite(circle), child: const Text('Invite')),
                    TextButton(onPressed: () => _toggleEvents(circle), child: const Text('Events')),
                  ]),
                  if (_trees[circle['id']] != null)
                    for (final rel in (_trees[circle['id']]!['relations'] as List).cast<Map>())
                      ListTile(
                        dense: true,
                        leading: const Icon(Icons.linear_scale, color: MotseTheme.dim),
                        title: Text(
                            '${(rel['member_ref'] as String).substring(0, 10)}… is ${rel['relation']} '
                            'of ${(rel['related_to'] as String).substring(0, 10)}…'),
                      ),
                  if (_events[circle['id']] != null)
                    for (final event in _events[circle['id']]!)
                      ListTile(
                        dense: true,
                        leading: const Icon(Icons.event, color: MotseTheme.accent),
                        title: Text(event['title'] as String),
                        subtitle: Text('${event['kind']} · ${event['date']}'),
                      ),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}
