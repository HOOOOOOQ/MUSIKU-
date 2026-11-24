import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/core/api.dart';
void main() {
  test('extracts list and paginated records', () {
    expect(records({'items': [{'title': 'Licensed catalog'}]}).single['title'], 'Licensed catalog');
    expect(records(null), isEmpty);
  });
  test('stable entity identifier prefers database reference', () {
    expect(entityId({'_id': 'atlas-id', 'providerId': '5'}), 'atlas-id');
    expect(entityId({'source': 'itunes', 'providerId': '5'}), 'itunes:5');
  });
}
