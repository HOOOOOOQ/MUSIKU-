import 'package:audio_service/audio_service.dart';
import 'package:just_audio/just_audio.dart';

late MusikuAudio audio;

class MusikuAudio extends BaseAudioHandler with SeekHandler {
  final AudioPlayer player;
  MusikuAudio({AudioPlayer? audioPlayer})
    : player = audioPlayer ?? AudioPlayer() {
    player.playbackEventStream.listen((event) {
      playbackState.add(
        PlaybackState(
          controls: [
            MediaControl.skipToPrevious,
            player.playing ? MediaControl.pause : MediaControl.play,
            MediaControl.stop,
            MediaControl.skipToNext,
          ],
          systemActions: const {MediaAction.seek},
          androidCompactActionIndices: const [0, 1, 3],
          processingState: const {
            ProcessingState.idle: AudioProcessingState.idle,
            ProcessingState.loading: AudioProcessingState.loading,
            ProcessingState.buffering: AudioProcessingState.buffering,
            ProcessingState.ready: AudioProcessingState.ready,
            ProcessingState.completed: AudioProcessingState.completed,
          }[player.processingState]!,
          playing: player.playing,
          updatePosition: player.position,
          bufferedPosition: player.bufferedPosition,
          speed: player.speed,
        ),
      );
    });
    player.currentIndexStream.listen((index) {
      if (index != null && index < queue.value.length) {
        mediaItem.add(queue.value[index]);
      }
    });
  }
  Future<void> load(MediaItem item) async {
    queue.add([item]);
    mediaItem.add(item);
    await player.setAudioSource(AudioSource.uri(Uri.parse(item.id), tag: item));
    await play();
  }

  @override
  Future<void> play() => player.play();
  @override
  Future<void> pause() => player.pause();
  @override
  Future<void> seek(Duration position) => player.seek(position);
  @override
  Future<void> skipToNext() => player.seekToNext();
  @override
  Future<void> skipToPrevious() => player.seekToPrevious();
  @override
  Future<void> stop() async {
    await player.stop();
    await super.stop();
  }
}
