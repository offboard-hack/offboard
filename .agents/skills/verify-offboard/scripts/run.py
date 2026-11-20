#!/usr/bin/env python3
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[4]
HOST = "127.0.0.1"
DEFAULT_API_ORIGIN = "http://localhost:5173"


def endpoints():
    with socket.socket() as web, socket.socket() as api:
        web.bind((HOST, 0))
        api.bind((HOST, 0))
        return web.getsockname()[1], api.getsockname()[1]


def listening_pids(port):
    result = subprocess.run(
        ["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
        text=True,
        capture_output=True,
        check=False,
    )
    return {int(pid) for pid in result.stdout.split()}


def require_listener(port, process):
    pids = listening_pids(port)
    if not pids or any(os.getpgid(pid) != process.pid for pid in pids):
        raise RuntimeError(f"Port {port} is not owned exclusively by this run: {sorted(pids)}")
    return sorted(pids)


def doctor(web_port, api_port, web, api):
    web_url = f"http://{HOST}:{web_port}"
    api_url = f"http://{HOST}:{api_port}/api/health"
    web_pids = require_listener(web_port, web)
    api_pids = require_listener(api_port, api)
    with urlopen(Request(api_url, headers={"Origin": DEFAULT_API_ORIGIN}), timeout=4) as response:
        health = json.load(response)
        if health != {"status": "ok"} or response.headers.get("Access-Control-Allow-Origin") != DEFAULT_API_ORIGIN:
            raise RuntimeError("API health or CORS differs from the verification instance")
    with urlopen(f"{web_url}/desligamentos", timeout=8) as response:
        html = response.read().decode("utf-8")
        if "Marina Lopes" not in html or "Desligamentos" not in html:
            raise RuntimeError("The Offboard case list did not render its seeded records")
    return {
        "web": {"url": web_url, "listener_pids": web_pids},
        "api": {"url": api_url, "listener_pids": api_pids, "health": health},
    }


def stop_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def run(evidence, driver):
    if not shutil.which("lsof"):
        raise RuntimeError("lsof is required to verify listener ownership")
    if not driver.is_file():
        raise RuntimeError(f"Driver file does not exist: {driver}")

    evidence.mkdir(parents=True, exist_ok=False)
    web_port, api_port = endpoints()
    web_url = f"http://{HOST}:{web_port}"
    env = {
        **os.environ,
        "API_HOST": HOST,
        "API_PORT": str(api_port),
        "OFFBOARD_VERIFY_URL": web_url,
        "OFFBOARD_VERIFY_EVIDENCE": str(evidence),
    }
    env.pop("WEB_ORIGIN", None)
    processes = []
    servers = []
    doctor_note = {"revision": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain"))}

    def launch(command, log):
        with (evidence / log).open("w") as output:
            child = subprocess.Popen(
                command, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        processes.append(child)
        return child

    try:
        api = launch(["npm", "run", "dev", "-w", "@offboard/api"], "api.log")
        servers.append((api_port, api))
        web = launch(
            ["npm", "run", "dev", "-w", "@offboard/web", "--", "--host", HOST, "--port", str(web_port), "--strictPort"],
            "web.log",
        )
        servers.append((web_port, web))
        deadline = time.monotonic() + 60
        while True:
            if any(child.poll() is not None for child in (web, api)):
                raise RuntimeError("A server exited before readiness. See web.log and api.log.")
            try:
                doctor_note.update(doctor(web_port, api_port, web, api))
                break
            except (RuntimeError, OSError, ValueError) as error:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"Doctor did not pass: {error}") from error
                time.sleep(0.4)

        (evidence / "doctor.json").write_text(json.dumps(doctor_note, indent=2) + "\n")
        drive = launch(["node", str(driver)], "drive.log")
        try:
            result = drive.wait(timeout=150)
        except subprocess.TimeoutExpired:
            stop_group(drive)
            result = 124
        if result:
            try:
                doctor_note.update(doctor(web_port, api_port, web, api))
                doctor_note["after_failed_drive"] = "healthy"
            except (RuntimeError, OSError, ValueError) as error:
                doctor_note["after_failed_drive"] = str(error)
            (evidence / "doctor.json").write_text(json.dumps(doctor_note, indent=2) + "\n")
            raise RuntimeError(f"Browser drive exited {result}. See drive.log.")
    finally:
        for child in reversed(processes):
            stop_group(child)
        remaining = {
            str(port): sorted(listening_pids(port))
            for port, _ in servers
            if listening_pids(port)
        }
        (evidence / "cleanup.json").write_text(
            json.dumps({"listeners_remaining": remaining}, indent=2) + "\n"
        )
        if remaining:
            raise RuntimeError(f"Ports still have listeners after cleanup: {remaining}")

    print(f"Verification complete. Evidence: {evidence}")


def interrupted(signum, _frame):
    raise SystemExit(128 + signum)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(f"Usage: {sys.argv[0]} NEW_EVIDENCE_DIRECTORY PLAYWRIGHT_DRIVER.mjs")
    signal.signal(signal.SIGTERM, interrupted)
    try:
        run(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
    except (OSError, RuntimeError) as error:
        sys.exit(str(error))
