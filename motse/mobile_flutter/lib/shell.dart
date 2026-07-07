import 'package:flutter/material.dart';

import 'features/heritage/heritage_screen.dart';
import 'features/home/home_screen.dart';
import 'features/kgetsi/kgetsi_screen.dart';
import 'features/lelapa/lelapa_screen.dart';
import 'features/loeto/loeto_screen.dart';
import 'features/more/more_screen.dart';

/// Bottom navigation on phones; navigation rail on tablets (>= 720dp).
class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _index = 0;

  static const _screens = [
    HomeScreen(),
    HeritageScreen(),
    KgetsiScreen(),
    LoetoScreen(),
    LelapaScreen(),
    MoreScreen(), // Puo · Wallet · Notifications · Identity
  ];

  static const _destinations = [
    (Icons.home_outlined, 'Gae'),
    (Icons.library_music_outlined, 'Ditso'),
    (Icons.volunteer_activism_outlined, 'Kgetsi'),
    (Icons.travel_explore_outlined, 'Loeto'),
    (Icons.family_restroom_outlined, 'Lelapa'),
    (Icons.apps_outlined, 'More'),
  ];

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 720;
    final body = IndexedStack(index: _index, children: _screens);
    if (wide) {
      return Scaffold(
        body: Row(children: [
          NavigationRail(
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() => _index = i),
            labelType: NavigationRailLabelType.all,
            destinations: [
              for (final (icon, label) in _destinations)
                NavigationRailDestination(icon: Icon(icon), label: Text(label)),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: body),
        ]),
      );
    }
    return Scaffold(
      body: body,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final (icon, label) in _destinations)
            NavigationDestination(icon: Icon(icon), label: label),
        ],
      ),
    );
  }
}
