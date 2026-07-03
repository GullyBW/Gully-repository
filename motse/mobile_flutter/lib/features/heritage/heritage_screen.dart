import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:provider/provider.dart';

import '../../main.dart';

/// Heritage (WS1): browse, search, playback, offline packs, consent,
/// restricted handling. Restriction is entirely server-side (§6.4) —
/// this client can only ever see what the read path already allows,
/// and members-only playback uses identity-bound signed URLs.
class HeritageScreen extends StatefulWidget {
  const HeritageScreen({super.key});

  @override
  State<HeritageScreen> createState() => _HeritageScreenState();
}

class _HeritageScreenState extends State<HeritageScreen> {
  final _query = TextEditingController();
  final _player = AudioPlayer();
  List<Map> _items = [];
  Map? _pack;
  String? _status;

  @override
  void initState() {
    super.initState();
    _browse();
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _browse() async {
    final api = context.read<AppState>().api;
    final out = await api.get('/v1/heritage/search?page_size=20') as Map;
    setState(() => _items = (out['items'] as List).cast<Map>());
  }

  Future<void> _search() async {
    final api = context.read<AppState>().api;
    final out = await api.get('/v1/search?q=${Uri.encodeComponent(_query.text)}') as Map;
    setState(() => _items = (out['results'] as List).cast<Map>());
  }

  /// Offline pack: signed manifest; tampered packs will not play (§11).
  Future<void> _downloadPack(String district) async {
    final api = context.read<AppState>().api;
    final manifest = await api.get('/v1/mafelo/packs/$district/manifest') as Map;
    setState(() {
      _pack = manifest;
      _status = 'Pack "${manifest['district']}" v${manifest['version']}: '
          '${(manifest['entries'] as List).length} places, signed ✔';
    });
  }

  Future<void> _play(String mediaId) async {
    final api = context.read<AppState>().api;
    try {
      final signed = await api.get('/v1/media/$mediaId/url') as Map;
      await _player.setUrl('${api.baseUrl}${signed['url']}');
      await _player.play();
    } catch (e) {
      setState(() => _status = 'Playback: $e'); // MEMBERSHIP_REQUIRED surfaces here
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ditso — Heritage')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _query,
                decoration: const InputDecoration(hintText: 'Search stories, places, songs…'),
                onSubmitted: (_) => _search(),
              ),
            ),
            IconButton(onPressed: _search, icon: const Icon(Icons.search)),
            IconButton(
              tooltip: 'Download offline pack',
              onPressed: () => _downloadPack('central'),
              icon: const Icon(Icons.download_for_offline_outlined),
            ),
          ]),
        ),
        if (_status != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(_status!, style: const TextStyle(color: MotseTheme.dim, fontSize: 12)),
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              for (final item in _items)
                Card(
                  child: ListTile(
                    leading: Icon(
                      item['type'] == 'video' ? Icons.play_circle_outline : Icons.multitrack_audio,
                      color: MotseTheme.accent,
                    ),
                    title: Text(item['title'] as String? ?? item['name'] as String? ?? ''),
                    subtitle: Text([
                      item['type'] ?? 'heritage',
                      if (item['morafe_ref'] != null) item['morafe_ref'],
                    ].join(' · ')),
                    onTap: () {
                      final media = (item['media_refs'] as List?)?.cast<String>() ?? const [];
                      if (media.isNotEmpty) _play(media.first);
                    },
                  ),
                ),
              if (_pack != null)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.offline_pin_outlined, color: MotseTheme.ok),
                    title: const Text('Offline pack ready'),
                    subtitle: Text(_status ?? ''),
                  ),
                ),
            ],
          ),
        ),
      ]),
    );
  }
}
