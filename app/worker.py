"""后台任务处理线程。

任务在服务端独立执行，浏览器关掉、手机切后台、页面刷新都不影响；
执行结果写回 SQLite，并按用户分目录存档到 output/。
"""
import threading
import traceback

from . import db, provider


class WorkerPool:
    def __init__(self):
        self.stop_event = threading.Event()
        self.wake_event = threading.Event()
        self.threads = []
        self.concurrency = 0

    def start(self, concurrency: int = 1):
        concurrency = max(1, min(8, int(concurrency or 1)))
        self.concurrency = concurrency
        self.stop_event.clear()
        for i in range(concurrency):
            t = threading.Thread(target=self._loop, name="image-worker-%d" % i,
                                 daemon=True, args=(i,))
            t.start()
            self.threads.append(t)

    def resize(self, concurrency: int):
        target = max(1, min(8, int(concurrency or 1)))
        if target > self.concurrency:
            for i in range(self.concurrency, target):
                t = threading.Thread(target=self._loop, name="image-worker-%d" % i,
                                     daemon=True, args=(i,))
                t.start()
                self.threads.append(t)
        # 缩减时不再强行杀线程：多余的 slot 会在下一轮循环自行退出，
        # 正在处理的任务不受影响，改完设置立即按新并发数运行。
        self.concurrency = target
        self.wake_event.set()

    def notify(self):
        self.wake_event.set()

    def stop(self):
        self.stop_event.set()
        self.wake_event.set()
        for t in self.threads:
            t.join(timeout=2)

    def _loop(self, slot):
        while not self.stop_event.is_set() and slot < self.concurrency:
            try:
                task = db.claim_next()
            except Exception:
                task = None
            if task:
                self._process(task)
            else:
                self.wake_event.wait(1.0)
                self.wake_event.clear()

    def _process(self, task: dict):
        tid = task["id"]
        try:
            cfg = db.cfg_for_image(task.get("provider_id") or None)
            items = provider.generate(cfg, task)
            names = provider.save_images(tid, items, task)
            # 任务可能在处理期间被用户删除；删掉刚生成的孤儿文件
            if not db.finish_ok(tid, names):
                provider.remove_files(names)
        except Exception as e:
            detail = "%s: %s" % (type(e).__name__, e)
            if not isinstance(e, provider.ImageAPIError):
                detail += "\n" + traceback.format_exc(limit=6)[-1500:]
            cfg = db.get_settings()
            try:
                retries = int(cfg.get("auto_retry") or 0)
            except ValueError:
                retries = 0
            attempts = int(task.get("attempts") or 1)
            if attempts <= retries:
                db.requeue(tid, "第 %d 次失败，自动重试中… %s" % (attempts, detail))
                self.wake_event.set()
            else:
                db.finish_fail(tid, detail)
        finally:
            self.wake_event.set()


pool = WorkerPool()
