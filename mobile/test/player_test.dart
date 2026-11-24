import 'package:audio_service/audio_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:mocktail/mocktail.dart';
import 'package:musiku_plus/core/audio.dart';

class MockPlayer extends Mock implements AudioPlayer {}

void main() {
  test('preview player loads source and forwards transport controls', () async {
    final player = MockPlayer();
    registerFallbackValue(Duration.zero);
    registerFallbackValue(
      AudioSource.uri(Uri.parse('https://example.invalid/audio')),
    );
    when(
      () => player.playbackEventStream,
    ).thenAnswer((_) => const Stream<PlaybackEvent>.empty());
    when(
      () => player.currentIndexStream,
    ).thenAnswer((_) => const Stream<int?>.empty());
    when(
      () => player.setAudioSource(any()),
    ).thenAnswer((_) async => const Duration(seconds: 30));
    when(() => player.play()).thenAnswer((_) async {});
    when(() => player.pause()).thenAnswer((_) async {});
    when(() => player.seek(any())).thenAnswer((_) async {});
    registerFallbackValue(Duration.zero);
    final handler = MusikuAudio(audioPlayer: player);
    await handler.load(
      const MediaItem(
        id: 'https://example.invalid/preview.mp3',
        title: 'Unit test',
      ),
    );
    expect(handler.mediaItem.value?.title, 'Unit test');
    expect(handler.queue.value.length, 1);
    await handler.pause();
    await handler.seek(const Duration(seconds: 10));
    verify(() => player.play()).called(1);
    verify(() => player.pause()).called(1);
    verify(() => player.seek(const Duration(seconds: 10))).called(1);
  });
}
