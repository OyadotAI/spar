package ai.oya.keel;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * What changed, pushed to every window. The app never polls: it subscribes here once and
 * re-reads whatever a frame names. Kinds (the data shape is documented next to each emit site):
 * state.changed · jobs.changed {added, removed} · job.changed {name, rev?, remote?} ·
 * run.changed {job, run} · pending {lane} · turn {lane, turn, fact} · git.changed {lane} ·
 * aws.auth {fix} · live.changed {mode, ...}
 */
@RestController
public class Events {
    private final List<SseEmitter> subs = new CopyOnWriteArrayList<>();
    private final AtomicLong seq = new AtomicLong();

    public void emit(String kind, Object data) {
        long n = seq.incrementAndGet();
        for (SseEmitter s : subs) {
            try {
                s.send(SseEmitter.event().id(Long.toString(n)).name(kind).data(Map.of("seq", n, "kind", kind, "data", data)));
            } catch (IOException | IllegalStateException e) {
                subs.remove(s);
            }
        }
    }

    /** Loops that cost AWS calls pause when nobody is watching. */
    public boolean hasSubscribers() { return !subs.isEmpty(); }

    @GetMapping("/api/events")
    public SseEmitter events() throws IOException { // no-blocking: memory only
        SseEmitter e = new SseEmitter(0L);
        subs.add(e);
        Runnable drop = () -> subs.remove(e);
        e.onCompletion(drop);
        e.onTimeout(drop);
        e.onError(t -> drop.run());
        e.send(SseEmitter.event().name("connected").data(Map.of("seq", seq.get())));
        return e;
    }

    /** A dead stream and a quiet one look the same to a client; the comment line tells them apart. */
    @Scheduled(fixedRate = 15_000)
    void heartbeat() {
        for (SseEmitter s : subs) {
            try { s.send(SseEmitter.event().comment("keep-alive")); }
            catch (IOException | IllegalStateException e) { subs.remove(s); }
        }
    }
}
