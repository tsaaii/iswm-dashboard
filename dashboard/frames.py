"""Latest picture of each camera, for pages that ask for one picture at a time.

Why: a browser allows only 6 connections to a site. A page showing 4-8 live camera
streams at once would use them all, and the rest of the page (numbers, menus) would
hang. So this server reads each camera's stream once, keeps its newest picture, and
the page fetches single pictures (about one a second).

A camera's stream is opened when a page first asks for it and closed 20 seconds after
the last ask, so the plant sends pictures only while someone is watching. Several
viewers of the same camera share one stream.
"""
import threading
import time

IDLE_CLOSE_S = 20


class _Feed:
    def __init__(self):
        self.jpeg = None
        self.at = 0.0
        self.asked = time.monotonic()
        self.thread = None
        self.error = None


class FrameHub:
    def __init__(self, opener):
        """opener(ulb, cam, quality) -> iterator of multipart MJPEG bytes, or None."""
        self.opener = opener
        self.feeds = {}
        self._lock = threading.Lock()

    def latest(self, ulb, cam, quality):
        """(jpeg bytes or None, seconds old). Starts the stream if it isn't running."""
        key = (ulb, cam, quality)
        with self._lock:
            f = self.feeds.get(key)
            if f is None:
                f = self.feeds[key] = _Feed()
            f.asked = time.monotonic()
            if f.thread is None or not f.thread.is_alive():
                f.thread = threading.Thread(target=self._read, args=(key, f), daemon=True, name="cam-%s-%s" % key[:2])
                f.thread.start()
        return f.jpeg, (time.monotonic() - f.at) if f.at else None

    def _read(self, key, f):
        stream = None
        try:
            stream = self.opener(*key)
            if stream is None:
                f.error = "No such camera"
                return
            buf = b""
            for chunk in stream:
                buf += chunk
                while True:  # take every complete JPEG out of the multipart stream
                    a = buf.find(b"\xff\xd8")
                    if a < 0:
                        buf = buf[-1:]
                        break
                    b = buf.find(b"\xff\xd9", a + 2)
                    if b < 0:
                        buf = buf[a:]
                        break
                    f.jpeg, f.at, f.error = buf[a:b + 2], time.monotonic(), None
                    buf = buf[b + 2:]
                if len(buf) > 4_000_000:
                    buf = b""
                if time.monotonic() - f.asked > IDLE_CLOSE_S:
                    return  # nobody looking: close, so the plant stops sending
        except Exception as e:
            f.error = str(e)[:200]
        finally:
            if stream is not None and hasattr(stream, "close"):
                try:
                    stream.close()
                except Exception:
                    pass
