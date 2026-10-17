"""Exercise the real terminal lifecycle against the explicit JSON protocol fixture."""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import termios
import time
from tempfile import TemporaryDirectory

root=Path(__file__).resolve().parents[1]
music=next(root.glob('*.mp3'))
music_directory=TemporaryDirectory(prefix='ascii-film-mp3-')
renamed_music=Path(music_directory.name)/'任意 文件名 renamed-track.MP3'
renamed_music.symlink_to(music.resolve())
def cli(*args):
 return subprocess.run(['node','--import','tsx','src/cli.ts',*args],cwd=root,capture_output=True,text=True,check=True).stdout
assert '--easter-egg    显示片尾彩蛋' in cli('--help')
assert '--easter-egg    Show the post-credits Easter egg' in cli('-h','--lang','en')
for readme in ('README.md','README.zh-CN.md'):
 assert '--easter-egg' not in (root/readme).read_text()
cli('check','--music-file',str(renamed_music))
cli('check','--music-file',os.path.relpath(renamed_music,root))
assert 'simtest_000329.elf' not in cli('render','--time','03:34.020','--lang','en')
assert 'simtest_000329.elf' in cli('render','--time','03:34.020','--lang','en','--easter-egg')
print('CLI cases passed: localized help, no README hint, arbitrary MP3 filenames and paths, default and opt-in frame exports.')
master,slave=pty.openpty()
before=termios.tcgetattr(slave)
def resize(columns,rows):fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
resize(160,45)
destination=root/'.cache/pty-smoke'
command=['node','--max-old-space-size=64','--max-semi-space-size=4','--import','tsx','src/cli.ts','play','--music-file',str(renamed_music),'--rehearsal','--seek','02:41.9','--mpv-path',str(root/'test/fixtures/fake-mpv.mjs'),'--export-dir',str(destination)]
process=subprocess.Popen(command,cwd=root,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
output=bytearray()
def drain(seconds):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  if select.select([master],[],[],min(.05,max(0,deadline-time.monotonic())))[0]:
   try:output.extend(os.read(master,262144))
   except OSError:break
try:
 deadline=time.monotonic()+8
 while '按回车开始'.encode() not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert '按回车开始'.encode() in output,output.decode(errors='replace')[-1500:]
 os.write(master,b'\r');drain(1.1)
 assert b'0xE0000001' in output and b'PROCESS_TERMINATED' in output,'Termination foreground not submitted.'
 assert b'lyric.76' not in output,'Rehearsal annotation bypassed the viewport corruption.'
 assert b'Execution' in output and '如果能够'.encode() in output,'Viewer captions did not advance during story termination.'
 os.write(master,b' ');drain(.1)
 resize(100,30);os.kill(process.pid,signal.SIGWINCH);drain(.2)
 assert '终端至少需要'.encode() in output,'Small terminal slate not submitted.'
 resize(130,35);os.kill(process.pid,signal.SIGWINCH);drain(.2)
 os.write(master,b'\x1b[C');drain(.2)
 os.write(master,b' ');drain(.2)
 os.write(master,b'q');drain(.5);process.wait(timeout=5)
 assert process.returncode==0,output.decode(errors='replace')[-1500:]
 assert b'\x1b[?1049h' in output and b'\x1b[?1049l' in output,'Alternate screen not restored.'
 assert termios.tcgetattr(slave)==before,'Raw input flags not restored.'
 events=json.loads((destination/'events.json').read_text())
 assert sum(event['kind']=='rx' for event in events)==9,'Requests duplicated after seek.'
 assert sum(event['kind']=='CLOSE' for event in events)==1,'Close duplicated.'
 destination.mkdir(parents=True,exist_ok=True)
 (destination/'terminal.ansi').write_bytes(output)
 print('PTY fixture passed: ready/start, termination, pause, resize, seek, quit, terminal restore, no duplicate requests.')
 # The actual application must also restore the terminal on an IPC failure.
 command[command.index('--seek')+1]='0'
 command[command.index('--export-dir')+1]=str(root/'.cache/pty-smoke-error')
 output=bytearray();resize(220,60)
 process=subprocess.Popen(command,cwd=root,stdin=slave,stdout=slave,stderr=slave,start_new_session=True,env={**os.environ,'FAKE_MPV_EXIT_AFTER_MS':'1500'})
 deadline=time.monotonic()+5
 while '按回车开始'.encode() not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert '按回车开始'.encode() in output
 os.write(master,b'\r');drain(.2)
 assert '内存'.encode() in output and b'revision=' in output,'Full-screen side panels clipped beyond the reference viewport.'
 resize(240,64);os.kill(process.pid,signal.SIGWINCH);drain(2);process.wait(timeout=5)
 assert process.returncode==1
 assert b'\x1b[?1049l' in output and b'PROTECTED_SYSTEM_DELETE' not in output
 assert termios.tcgetattr(slave)==before
 print('PTY player-failure case passed: full-screen panels at 220x60 / 240x64, real ERROR, no story termination, terminal restored.')
 # Short rehearsal loops must actually seek the media and rebuild one request
 # history, rather than continuously adding duplicate scripted sends.
 destination=root/'.cache/pty-smoke-loop';destination.mkdir(parents=True,exist_ok=True)
 trace=destination/'commands.jsonl';trace.unlink(missing_ok=True)
 command[command.index('--export-dir')+1]=str(destination)
 output=bytearray();resize(130,35)
 process=subprocess.Popen(command+['--loop','00:29.8..00:30.4'],cwd=root,stdin=slave,stdout=slave,stderr=slave,start_new_session=True,
                          env={**os.environ,'FAKE_MPV_COMMAND_LOG':str(trace)})
 deadline=time.monotonic()+5
 while '按回车开始'.encode() not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert '按回车开始'.encode() in output
 os.write(master,b'\r');drain(2.2);os.write(master,b'q');drain(.3);process.wait(timeout=5)
 assert process.returncode==0,output.decode(errors='replace')[-1500:]
 commands=[json.loads(line) for line in trace.read_text().splitlines()]
 assert sum(command[0]=='seek' and command[1]==29.8 for command in commands)>=3,'Rehearsal did not loop the real media position.'
 events=json.loads((destination/'events.json').read_text())
 assert sum(event['kind']=='rx' for event in events)==2,'Loop replay duplicated scripted requests.'
 assert termios.tcgetattr(slave)==before
 assert b'\x1b[?1049l' in output
 print('PTY loop case passed: repeated exact media seeks, deterministic rebuild, no duplicate requests, terminal restored.')
 # Default playback ends at the real EOF, with no hidden Easter-egg wait.
 destination=root/'.cache/pty-v43-default-eof';destination.mkdir(parents=True,exist_ok=True)
 command[command.index('--export-dir')+1]=str(destination)
 command[command.index('--seek')+1]='03:31.8'
 output=bytearray();resize(130,35)
 process=subprocess.Popen(command+['--speed','2'],cwd=root,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
 deadline=time.monotonic()+5
 while '按回车开始'.encode() not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert '按回车开始'.encode() in output
 started=time.monotonic();os.write(master,b'\r')
 while process.poll() is None and time.monotonic()-started<2:drain(.05)
 assert process.poll() is not None,'Default EOF retained the silent Easter-egg tail.'
 process.wait(timeout=2)
 assert process.returncode==0,output.decode(errors='replace')[-1500:]
 assert b'PROGRAM DELETED' in output and b'simtest_000329.elf' not in output
 assert b'\x1b[?1049l' in output and termios.tcgetattr(slave)==before
 events=json.loads((destination/'events.json').read_text())
 assert not any(event.get('key')=='host.next_test' for event in events)
 assert sum(event['kind']=='PURGE' for event in events)==1
 print('PTY default EOF case passed: immediate finish, one deletion, no Easter-egg event, terminal restored.')
 # Holding the default end must not implicitly enable test 329.
 destination=root/'.cache/pty-v43-default-hold';destination.mkdir(parents=True,exist_ok=True)
 command[command.index('--export-dir')+1]=str(destination)
 output=bytearray()
 process=subprocess.Popen(command+['--speed','2','--hold-end'],cwd=root,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
 deadline=time.monotonic()+5
 while '按回车开始'.encode() not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert '按回车开始'.encode() in output
 os.write(master,b'\r');drain(2.6)
 assert process.poll() is None and b'PROGRAM DELETED' in output and b'simtest_000329.elf' not in output
 os.write(master,b'q');drain(.3);process.wait(timeout=5)
 assert process.returncode==0 and termios.tcgetattr(slave)==before
 events=json.loads((destination/'events.json').read_text())
 assert not any(event.get('key')=='host.next_test' for event in events)
 print('PTY default hold case passed: DELETED retained until explicit quit, no implicit Easter egg.')
 # Audio EOF must leave the silent visual tail alive. Pausing/resizing freezes
 # its clock; test 329 appears only after the retained DELETED interval.
 destination=root/'.cache/pty-v43-eof';destination.mkdir(parents=True,exist_ok=True)
 trace=destination/'commands.jsonl';trace.unlink(missing_ok=True)
 command[command.index('--export-dir')+1]=str(destination)
 command[command.index('--seek')+1]='03:31.8'
 output=bytearray();resize(130,35)
 process=subprocess.Popen(command+['--speed','2','--easter-egg'],cwd=root,stdin=slave,stdout=slave,stderr=slave,start_new_session=True,
                          env={**os.environ,'FAKE_MPV_COMMAND_LOG':str(trace)})
 deadline=time.monotonic()+5
 while '按回车开始'.encode() not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert '按回车开始'.encode() in output
 os.write(master,b'\r');drain(.4)
 assert process.poll() is None,'Application exited at audio EOF before the Easter egg.'
 assert b'PROGRAM DELETED' in output and b'simtest_000329.elf' not in output
 os.write(master,b' ');drain(1.3)
 assert process.poll() is None and b'simtest_000329.elf' not in output,'Paused tail kept advancing.'
 resize(100,30);os.kill(process.pid,signal.SIGWINCH);drain(.1)
 resize(130,35);os.kill(process.pid,signal.SIGWINCH);drain(.3)
 assert process.poll() is None and b'simtest_000329.elf' not in output,'Resize resumed the silent tail.'
 os.write(master,b' ')
 deadline=time.monotonic()+5
 while process.poll() is None and time.monotonic()<deadline:drain(.1)
 process.wait(timeout=2)
 assert process.returncode==0,output.decode(errors='replace')[-1500:]
 assert b'simtest_000329.elf' in output and termios.tcgetattr(slave)==before
 events=json.loads((destination/'events.json').read_text())
 assert sum(event.get('key')=='host.next_test' for event in events)==1
 commands=[json.loads(line) for line in trace.read_text().splitlines()]
 assert sum(command[0]=='loadfile' for command in commands)==1,'EOF tail replayed the song.'
 assert sum(command[:3]==['set_property','pause',False] for command in commands)==1,'Silent resume restarted audio.'
 print('PTY EOF case passed: no early exit, silent pause/resize/resume, one Easter egg, no music replay, automatic finish.')
 # Direct rehearsal entry into the visual tail supports rewinding into audio;
 # --hold-end then preserves the final Easter-egg frame until explicit quit.
 destination=root/'.cache/pty-v43-tail-seek';destination.mkdir(parents=True,exist_ok=True)
 trace=destination/'commands.jsonl';trace.unlink(missing_ok=True)
 command[command.index('--export-dir')+1]=str(destination)
 command[command.index('--seek')+1]='03:33.4'
 output=bytearray()
 process=subprocess.Popen(command+['--speed','2','--hold-end','--easter-egg'],cwd=root,stdin=slave,stdout=slave,stderr=slave,start_new_session=True,
                          env={**os.environ,'FAKE_MPV_COMMAND_LOG':str(trace)})
 deadline=time.monotonic()+5
 while '按回车开始'.encode() not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert '按回车开始'.encode() in output
 os.write(master,b'\r');drain(.1);os.write(master,b'\x1b[D');drain(.2)
 deadline=time.monotonic()+6
 while b'simtest_000329.elf' not in output and time.monotonic()<deadline and process.poll() is None:drain(.1)
 assert b'simtest_000329.elf' in output and process.poll() is None,output.decode(errors='replace')[-1500:]
 drain(1.3);assert process.poll() is None,'--hold-end did not retain the Easter egg.'
 os.write(master,b'q');drain(.3);process.wait(timeout=5)
 assert process.returncode==0 and termios.tcgetattr(slave)==before
 events=json.loads((destination/'events.json').read_text())
 assert sum(event.get('key')=='host.next_test' for event in events)==1 and sum(event['kind']=='rx' for event in events)==9
 commands=[json.loads(line) for line in trace.read_text().splitlines()]
 assert any(command[0]=='seek' and command[1]<211 for command in commands),'Tail rewind never returned to media.'
 print('PTY tail-entry case passed: direct post-EOF start, rewind to media, deterministic history, hold final frame, explicit quit.')
finally:
 if process.poll() is None:
  process.terminate()
  try:process.wait(timeout=2)
  except subprocess.TimeoutExpired:process.kill();process.wait()
 os.close(master);os.close(slave)
 music_directory.cleanup()
