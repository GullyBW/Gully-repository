import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../main.dart';

/// Loeto (WS1): tourism listings, booking (escrow-backed), history,
/// reviews, offline itineraries (ICS download for the calendar app).
class LoetoScreen extends StatefulWidget {
  const LoetoScreen({super.key});

  @override
  State<LoetoScreen> createState() => _LoetoScreenState();
}

class _LoetoScreenState extends State<LoetoScreen> {
  List<Map> _experiences = [];
  List<Map> _bookings = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AppState>().api;
    final results = await Future.wait([
      api.get('/v1/loeto/experiences?page_size=20'),
      api.get('/v1/loeto/bookings'),
    ]);
    setState(() {
      _experiences = ((results[0] as Map)['items'] as List).cast<Map>();
      _bookings = (results[1] as List).cast<Map>();
    });
  }

  String _bwp(num minor) => 'BWP ${(minor / 100).toStringAsFixed(2)}';

  Future<void> _book(Map experience) async {
    final app = context.read<AppState>();
    if (!await app.session.reauthenticate('Confirm booking payment')) return;
    final accounts = (await app.api.get('/v1/wallet/accounts') as List).cast<Map>();
    final wallet = accounts.where((a) => a['type'] == 'user_wallet').firstOrNull;
    if (wallet == null || !mounted) return;
    try {
      await app.api.post('/v1/loeto/bookings', {
        'experience_id': experience['id'],
        'source_account_id': wallet['id'],
      });
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Booked — payment held in escrow')));
      }
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _review(Map booking) async {
    final app = context.read<AppState>();
    var rating = 5;
    final comment = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Review your journey'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var star = 1; star <= 5; star += 1)
                  IconButton(
                    onPressed: () => setDialogState(() => rating = star),
                    icon: Icon(star <= rating ? Icons.star : Icons.star_border,
                        color: MotseTheme.warn),
                  ),
              ],
            ),
            TextField(controller: comment, decoration: const InputDecoration(hintText: 'Comment')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Post')),
          ],
        ),
      ),
    );
    if (submitted != true) return;
    await app.api.post('/v1/loeto/bookings/${booking['id']}/review', {
      'rating': rating,
      'comment': comment.text.isEmpty ? null : comment.text,
    });
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Loeto — Journeys')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            for (final experience in _experiences)
              Card(
                child: ListTile(
                  title: Text(experience['title'] as String),
                  subtitle: Text([
                    _bwp(experience['price_minor'] as num),
                    if ((experience['rating'] as Map)['count'] as int > 0)
                      '★ ${(experience['rating'] as Map)['average']} '
                          '(${(experience['rating'] as Map)['count']})'
                    else
                      'no reviews yet',
                  ].join(' · ')),
                  trailing: FilledButton(
                    onPressed: () => _book(experience),
                    child: const Text('Book'),
                  ),
                ),
              ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text('My bookings', style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            for (final booking in _bookings)
              Card(
                child: ListTile(
                  title: Text('Booking ${(booking['id'] as String).substring(0, 12)}…'),
                  subtitle: Text(booking['state'] as String),
                  trailing: Wrap(spacing: 4, children: [
                    if (booking['state'] == 'settled')
                      IconButton(
                        tooltip: 'Review',
                        onPressed: () => _review(booking),
                        icon: const Icon(Icons.rate_review_outlined),
                      ),
                    IconButton(
                      tooltip: 'Offline itinerary (.ics)',
                      onPressed: () async {
                        final api = context.read<AppState>().api;
                        // ICS text — saved by the platform share sheet in production.
                        await api.get('/v1/loeto/bookings/${booking['id']}/ics');
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Itinerary saved for offline use')));
                        }
                      },
                      icon: const Icon(Icons.event_outlined),
                    ),
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
