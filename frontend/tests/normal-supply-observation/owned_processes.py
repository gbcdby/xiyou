"""Linux任务后代监督：pidfd身份、subreaper收养、全局绝对截止；导入无执行副作用。"""
import ctypes
import errno
import math
import os
import select
import signal
import subprocess
import sys
import threading
import time

PR_SET_CHILD_SUBREAPER = 36
PR_GET_CHILD_SUBREAPER = 37
_GONE = {errno.ENOENT, errno.ESRCH, errno.ENOTDIR}

class SupervisionInterrupted(BaseException):
    def __init__(self, signum):
        self.signum = signum
        super().__init__('监督进程收到中断信号')

def _read_stat(directory_fd):
    descriptor = None
    try:
        descriptor = os.open('stat', os.O_RDONLY | os.O_CLOEXEC, dir_fd=directory_fd)
        value = os.read(descriptor, 8192).decode('utf-8', errors='replace')
    except OSError as error:
        if error.errno in _GONE:
            return None
        raise
    finally:
        if descriptor is not None:
            os.close(descriptor)
    left = value.find('(')
    right = value.rfind(')')
    if left < 1 or right <= left:
        raise RuntimeError('proc stat形状无效')
    pid = int(value[:left].strip())
    fields = value[right + 1:].split()
    if len(fields) < 20:
        raise RuntimeError('proc stat字段不足')
    return {'pid': pid, 'state': fields[0], 'ppid': int(fields[1]), 'pgid': int(fields[2]),
            'sid': int(fields[3]), 'starttime': int(fields[19])}

def read_identity(pid):
    """只读身份，供证据核对；该结果本身不是信号授权。"""
    descriptor = None
    try:
        descriptor = os.open('/proc/%d' % pid, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        return _read_stat(descriptor)
    except OSError as error:
        if error.errno in _GONE:
            return None
        raise
    finally:
        if descriptor is not None:
            os.close(descriptor)

def _subreaper(value=None):
    libc = ctypes.CDLL(None, use_errno=True)
    function = libc.prctl
    function.restype = ctypes.c_int
    function.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    current = ctypes.c_int()
    result = function(PR_GET_CHILD_SUBREAPER, ctypes.addressof(current), 0, 0, 0)
    if result != 0:
        raise OSError(ctypes.get_errno(), '读取subreaper失败')
    if value is None:
        return current.value
    result = function(PR_SET_CHILD_SUBREAPER, int(value), 0, 0, 0)
    if result != 0:
        raise OSError(ctypes.get_errno(), '设置subreaper失败')
    result = function(PR_GET_CHILD_SUBREAPER, ctypes.addressof(current), 0, 0, 0)
    if result != 0 or current.value != int(value):
        raise RuntimeError('subreaper设置回读不符')
    return current.value

class _PinnedProcess:
    def __init__(self, pid):
        self.directory_fd = None
        self.pidfd = None
        try:
            self.directory_fd = os.open('/proc/%d' % pid, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            before = _read_stat(self.directory_fd)
            if before is None:
                raise ProcessLookupError(errno.ESRCH, '进程已经结束')
            self.pidfd = os.pidfd_open(pid, 0)
            after = _read_stat(self.directory_fd)
            if after is None or (before['pid'], before['starttime']) != (after['pid'], after['starttime']):
                raise ProcessLookupError(errno.ESRCH, '原proc对象已经结束')
            self.identity = (after['pid'], after['starttime'])
            self.latest = after
            self.sent = set()
            self.row = None
        except BaseException:
            self.close()
            raise
    def read(self):
        if self.directory_fd is None:
            return None
        current = _read_stat(self.directory_fd)
        if current is not None and (current['pid'], current['starttime']) != self.identity:
            raise RuntimeError('固定proc对象身份改变')
        self.latest = current
        return current
    def close(self):
        for name in ['pidfd', 'directory_fd']:
            descriptor = getattr(self, name, None)
            if descriptor is not None:
                os.close(descriptor)
                setattr(self, name, None)

def capabilities():
    """只读能力查询；不设置属性，不fork，不发信号。"""
    required_os = ['pidfd_open', 'waitid', 'waitpid', 'P_ALL', 'P_PIDFD', 'WEXITED', 'WNOHANG', 'WNOWAIT']
    if sys.platform != 'linux' or any(not hasattr(os, name) for name in required_os) or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('缺少Linux pidfd/wait能力，不允许降级')
    if threading.current_thread() is not threading.main_thread() or threading.active_count() != 1 or len(os.listdir('/proc/self/task')) != 1:
        raise RuntimeError('任务监督进程必须专用且单线程')
    own = read_identity(os.getpid())
    if own is None:
        raise RuntimeError('不能读取本监督进程身份')
    descriptor = os.pidfd_open(os.getpid(), 0)
    try:
        # signal=0只核内核支持/权限，无信号投递；拒绝只有Python符号却不可用的宿主。
        signal.pidfd_send_signal(descriptor, 0, None, 0)
    finally:
        os.close(descriptor)
    return {'python': sys.version.split()[0], 'linux': True, 'pidfdOpenSelf': True,
            'pidfdSendSignalPresent': True, 'pidfdSignalZeroSelf': True, 'waitidPresent': True, 'subreaperBefore': _subreaper(), 'owner': own}

class _OwnedRun:
    def __init__(self, wall_seconds, term_seconds, kill_seconds):
        for value in [wall_seconds, term_seconds, kill_seconds]:
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError('监督时间必须为有限正数')
        self.wall_seconds, self.term_seconds, self.kill_seconds = wall_seconds, term_seconds, kill_seconds
        self.started = time.monotonic()
        self.wall_deadline = self.started + wall_seconds
        self.absolute_deadline = self.wall_deadline + term_seconds + kill_seconds
        self.owner = os.getpid()
        self.handles = {}
        self.root_key = None
        self.process = None
        self.cleaning = False
        self.old_handlers = {}
        self.original_subreaper = None
        self.report = {'format': 1, 'ownerPID': self.owner, 'root': None, 'processes': [], 'signals': [],
                       'reaped': [], 'errors': [], 'interrupts': [], 'timedOut': False,
                       'rootSpawned': False, 'rootReaped': False, 'directChildrenECHILD': False,
                       'descendantsGone': False, 'ownedGroupsGone': False, 'ownedGroups': [], 'residuals': [],
                       'subreaperActive': False, 'subreaperRestored': False, 'supervisionQualified': False,
                       'budget': {'wallSeconds': wall_seconds, 'termSeconds': term_seconds, 'killSeconds': kill_seconds}}
    def error(self, code, error=None):
        item = {'code': code}
        if error is not None:
            item['type'] = type(error).__name__
        if item not in self.report['errors'] and len(self.report['errors']) < 32:
            self.report['errors'].append(item)
    def _interrupt(self, signum, _frame):
        if signum not in self.report['interrupts']:
            self.report['interrupts'].append(signum)
        if not self.cleaning:
            raise SupervisionInterrupted(signum)
    def _parent_owned(self, identity):
        if identity['ppid'] == self.owner:
            return {'pid': self.owner, 'starttime': self.owner_identity['starttime']}
        for key, handle in self.handles.items():
            if key[0] == identity['ppid']:
                current = handle.read()
                if current is not None:
                    return {'pid': key[0], 'starttime': key[1]}
        return None
    def _admit(self, pid, snapshot=None, root=False):
        handle = None
        try:
            handle = _PinnedProcess(pid)
            current = handle.latest
            if snapshot is not None and (current['pid'], current['starttime']) != (snapshot['pid'], snapshot['starttime']):
                handle.close()
                return None
            if handle.identity in self.handles:
                prior = self.handles[handle.identity]
                handle.close()
                return prior
            parent = self._parent_owned(current)
            if parent is None or root and current['ppid'] != self.owner:
                handle.close()
                return None
            row = {**current, 'parentIdentity': parent, 'root': root,
                   'adopted': not root and current['ppid'] == self.owner, 'seenPGIDs': [current['pgid']],
                   'seenPPIDs': [current['ppid']], 'reapedByOwner': False, 'goneSeen': False}
            handle.row = row
            self.handles[handle.identity] = handle
            self.report['processes'].append(row)
            return handle
        except OSError as error:
            if handle is not None:
                handle.close()
            if error.errno in _GONE:
                return None
            self.error('IDENTITY_PIN_FAILED', error)
            return None
        except BaseException as error:
            if handle is not None:
                handle.close()
            self.error('IDENTITY_PIN_FAILED', error)
            return None
    def _census(self, deadline):
        snapshot = []
        complete = True
        # 只读取数字身份与父关系；不会按命令/用户匹配信号目标。
        with os.scandir('/proc') as entries:
            for entry in entries:
                if time.monotonic() >= deadline:
                    complete = False
                    break
                if not entry.name.isdecimal():
                    continue
                try:
                    current = read_identity(int(entry.name))
                    if current is not None:
                        snapshot.append(current)
                except OSError as error:
                    if error.errno not in _GONE and int(entry.name) in {key[0] for key in self.handles}:
                        self.error('OWNED_PROC_READ_FAILED', error)
        changed = True
        while changed and time.monotonic() < deadline:
            changed = False
            parent_pids = {self.owner} | {key[0] for key in self.handles}
            for current in snapshot:
                if time.monotonic() >= deadline:
                    complete = False
                    break
                key = (current['pid'], current['starttime'])
                if current['pid'] == self.owner or key in self.handles or current['ppid'] not in parent_pids:
                    continue
                if self._admit(current['pid'], current) is not None:
                    changed = True
        if not complete:
            self.error('PROC_CENSUS_INCOMPLETE')
        return complete
    def _refresh(self):
        present = []
        for key, handle in self.handles.items():
            try:
                current = handle.read()
            except BaseException as error:
                self.error('OWNED_PROC_READ_FAILED', error)
                present.append({'pid': key[0], 'starttime': key[1], 'state': 'UNKNOWN'})
                continue
            if current is None:
                handle.row['goneSeen'] = True
                continue
            for field, output in [('pgid', 'seenPGIDs'), ('ppid', 'seenPPIDs')]:
                if current[field] not in handle.row[output]:
                    handle.row[output].append(current[field])
            if key != self.root_key and current['ppid'] == self.owner:
                handle.row['adopted'] = True
            present.append(current)
        return present
    def _reap(self, deadline):
        while time.monotonic() < deadline:
            try:
                info = os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            except ChildProcessError:
                self.report['directChildrenECHILD'] = True
                return True
            except BaseException as error:
                self.error('WAIT_ID_FAILED', error)
                return False
            self.report['directChildrenECHILD'] = False
            if info is None or info.si_pid == 0:
                return False
            handle = self._admit(info.si_pid)
            identity = handle.identity if handle is not None else None
            if identity is None:
                self.error('WAITABLE_IDENTITY_MISSING')
            try:
                pid, status = os.waitpid(info.si_pid, os.WNOHANG)
            except BaseException as error:
                self.error('WAIT_PID_FAILED', error)
                return False
            if pid == 0:
                self.error('WAITABLE_CHILD_CHANGED')
                return False
            code = os.waitstatus_to_exitcode(status)
            self.report['reaped'].append({'pid': pid, 'starttime': identity[1] if identity else None, 'status': status, 'exitCode': code})
            if handle is not None:
                handle.row['reapedByOwner'] = True
                handle.row['exitCode'] = code
            if self.root_key is not None and identity == self.root_key:
                self.process.returncode = code
                self.report['rootReaped'] = True
                self.report['root']['exitCode'] = code
        self.error('REAP_DEADLINE_REACHED')
        return False
    def _send(self, phase, deadline):
        for key, handle in reversed(list(self.handles.items())):
            if time.monotonic() >= deadline:
                return
            if phase in handle.sent:
                continue
            try:
                current = handle.read()
            except BaseException as error:
                self.error('OWNED_SIGNAL_PRECHECK_FAILED', error)
                # proc观察失败不撤销已固定pidfd的身份，也不能阻断剩余清理。
                current = {'state': 'UNKNOWN', 'pgid': handle.row['pgid']}
            if current is None or current['state'] in ['Z', 'X', 'x']:
                continue
            record = {'pid': key[0], 'starttime': key[1], 'pgid': current['pgid'],
                      'signal': signal.Signals(phase).name, 'atSeconds': time.monotonic() - self.started}
            try:
                signal.pidfd_send_signal(handle.pidfd, phase, None, 0)
                record['result'] = 'SENT'
            except ProcessLookupError:
                record['result'] = 'ALREADY_GONE'
            except BaseException as error:
                record['result'] = 'ERROR'
                self.error('OWNED_SIGNAL_FAILED', error)
            handle.sent.add(phase)
            self.report['signals'].append(record)
    def _drain(self, deadline, phase):
        while time.monotonic() < deadline:
            # 已证明归属的句柄优先处理，枚举故障不能耗尽本阶段才第一次发信号。
            try:
                self._send(phase, deadline)
            except BaseException as error:
                self.error('CLEANUP_SIGNAL_PASS_FAILED', error)
            census_complete, empty, present = False, False, None
            try:
                census_complete = self._census(deadline)
            except BaseException as error:
                self.error('CLEANUP_CENSUS_FAILED', error)
            try:
                empty = self._reap(deadline)
            except BaseException as error:
                self.error('CLEANUP_REAP_FAILED', error)
            try:
                present = self._refresh()
            except BaseException as error:
                self.error('CLEANUP_REFRESH_FAILED', error)
            if census_complete and empty and present == []:
                return True
            try:
                self._send(phase, deadline)
            except BaseException as error:
                self.error('CLEANUP_SIGNAL_PASS_FAILED', error)
            remaining = deadline - time.monotonic()
            if remaining > 0:
                time.sleep(min(.01, remaining))
        return False
    def run(self, command, cwd, env, stdout, stderr):
        try:
            available = capabilities()
            self.owner_identity = available['owner']
            self.report['capabilities'] = available
            self.original_subreaper = available['subreaperBefore']
            # ECHILD是内核对起始无子进程的确认，不消费别的工作的退出状态。
            try:
                os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            except ChildProcessError:
                pass
            else:
                raise RuntimeError('监督器起始已有其它子进程')
            if signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
                raise RuntimeError('SIGCHLD策略不是默认，拒绝混入其它回收者')
            signal.signal(signal.SIGCHLD, signal.SIG_DFL)
            _subreaper(1)
            self.report['subreaperActive'] = True
            for signum in [signal.SIGINT, signal.SIGTERM]:
                self.old_handlers[signum] = signal.getsignal(signum)
                signal.signal(signum, self._interrupt)
            self.process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
            self.report['rootSpawned'] = True
            root = self._admit(self.process.pid, root=True)
            if root is None:
                raise RuntimeError('根进程身份无法固定')
            self.root_key = root.identity
            self.report['root'] = {'pid': root.identity[0], 'starttime': root.identity[1], 'pgid': root.latest['pgid'], 'sid': root.latest['sid'], 'exitCode': None}
            poller = select.poll()
            poller.register(root.pidfd, select.POLLIN | select.POLLHUP | select.POLLERR)
            while not self.report['rootReaped']:
                remaining = self.wall_deadline - time.monotonic()
                if remaining <= 0:
                    self.report['timedOut'] = True
                    break
                events = poller.poll(max(1, math.ceil(remaining * 1000)))
                if time.monotonic() >= self.wall_deadline:
                    self.report['timedOut'] = True
                    break
                if events:
                    self._reap(self.wall_deadline)
                    if self.report['errors']:
                        break
        except SupervisionInterrupted:
            self.error('SUPERVISOR_INTERRUPTED')
        except BaseException as error:
            self.error('SUPERVISION_ERROR', error)
        finally:
            self.cleaning = True
            cleanup_started = time.monotonic()
            term_deadline = min(cleanup_started + self.term_seconds, self.absolute_deadline - self.kill_seconds)
            kill_deadline = min(term_deadline + self.kill_seconds, self.absolute_deadline)
            self.report['cleanupStartedSeconds'] = cleanup_started - self.started
            clean = False
            if self.report['subreaperActive']:
                try:
                    clean = self._drain(term_deadline, signal.SIGTERM)
                except BaseException as error:
                    self.error('TERM_CLEANUP_FAILED', error)
                if not clean:
                    try:
                        clean = self._drain(kill_deadline, signal.SIGKILL)
                    except BaseException as error:
                        self.error('KILL_CLEANUP_FAILED', error)
            elif not self.report['rootSpawned']:
                clean = True
            try:
                residuals = self._refresh()
            except BaseException as error:
                residuals = [{'state': 'UNKNOWN'}]
                self.error('FINAL_IDENTITY_CHECK_FAILED', error)
            self.report['residuals'] = residuals
            if self.report['rootSpawned'] and not self.report['rootReaped']:
                self.error('ROOT_WAIT_STATUS_MISSING')
            self.report['descendantsGone'] = clean and not residuals and self.report['directChildrenECHILD']
            groups = {}
            for handle in self.handles.values():
                for pgid in handle.row['seenPGIDs']:
                    groups.setdefault(pgid, []).append({'pid': handle.identity[0], 'starttime': handle.identity[1]})
            self.report['ownedGroups'] = [{'pgid': pgid, 'members': members,
                'remainingMembers': [item for item in residuals if item.get('pgid') == pgid]} for pgid, members in sorted(groups.items())]
            if self.report['subreaperActive'] and not self.report['descendantsGone']:
                self.error('OWNED_DESCENDANTS_REMAIN_OR_UNVERIFIED')
            self.report['ownedGroupsGone'] = self.report['descendantsGone'] and all(not group['remainingMembers'] for group in self.report['ownedGroups'])
            if self.report['subreaperActive'] and self.report['descendantsGone']:
                try:
                    _subreaper(self.original_subreaper)
                    self.report['subreaperRestored'] = True
                except BaseException as error:
                    self.error('SUBREAPER_RESTORE_FAILED', error)
            for signum, handler in self.old_handlers.items():
                signal.signal(signum, handler)
            for handle in self.handles.values():
                handle.close()
            self.report['elapsedSeconds'] = time.monotonic() - self.started
            self.report['observedExitSignals'] = [item for item in self.report['reaped'] if item['exitCode'] < 0]
            self.report['supervisionQualified'] = (self.report['rootSpawned'] and self.report['rootReaped']
                and self.report['descendantsGone'] and self.report['ownedGroupsGone'] and self.report['subreaperRestored']
                and not self.report['signals'] and not self.report['observedExitSignals'] and not self.report['timedOut'] and not self.report['interrupts'] and not self.report['errors'])
        return self.report

def run_owned(command, *, cwd, env, stdout, stderr, wall_seconds, term_seconds, kill_seconds):
    return _OwnedRun(wall_seconds, term_seconds, kill_seconds).run(command, cwd, env, stdout, stderr)
