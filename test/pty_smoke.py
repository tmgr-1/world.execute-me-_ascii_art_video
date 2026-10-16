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

root=Path(__file__).resolve().parents[1]
music=next(root.glob('*.mp3'))
master,slave=pty.openpty()
before=termios.tcgetattr(slave)
def resize(columns,rows):fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
resize(160,45)
destination=root/'.cache/pty-smoke'
command=['node','--max-old-space-size=64','--max-semi-space-size=4','--import','tsx','src/cli.ts','play','--music-file',str(music),'--rehearsal','--seek','02:41.9','--mpv-path',str(root/'test/fixtures/fake-mpv.mjs'),'--export-dir',str(destination)]
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
 assert b'PROCESS_TERMINATED' in output,'Termination foreground not submitted.'
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
 assert sum(event['kind']=='rx' for event in events)==8,'Requests duplicated after seek.'
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
 assert b'\x1b[?1049l' in output and b'PROCESS_TERMINATED' not in output
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
finally:
 if process.poll() is None:
  process.terminate()
  try:process.wait(timeout=2)
  except subprocess.TimeoutExpired:process.kill();process.wait()
 os.close(master);os.close(slave)
