"""Generate launchd plist / systemd unit files for the current user."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

TEMPLATE_DIR = Path(__file__).parent.parent.parent / "deploy"


def _find_binary() -> str:
    candidate = shutil.which("tokei-collect")
    if candidate:
        return candidate
    return f"{sys.executable} -m tokei_collector"


def install_launchd() -> int:
    if sys.platform != "darwin":
        print("install --launchd is only supported on macOS", file=sys.stderr)
        return 2

    template = TEMPLATE_DIR / "com.tokei.collector.plist.template"
    if not template.exists():
        print(f"template missing: {template}", file=sys.stderr)
        return 2

    log_dir = Path.home() / "Library" / "Logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    content = template.read_text()
    content = content.replace("__TOKEI_BINARY__", _find_binary())
    content = content.replace("__LOG_PATH__", str(log_dir))
    content = content.replace("__USER_LOCAL_BIN__", str(Path.home() / ".local" / "bin"))

    dest = Path.home() / "Library" / "LaunchAgents" / "com.tokei.collector.plist"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content)

    print(f"Installed launchd plist: {dest}")
    print("To activate:")
    print(f"  launchctl unload {dest} 2>/dev/null; launchctl load {dest}")
    return 0


def install_systemd() -> int:
    if sys.platform != "linux":
        print("install --systemd is only supported on Linux", file=sys.stderr)
        return 2

    service_template = TEMPLATE_DIR / "tokei-collector.service.template"
    timer_template = TEMPLATE_DIR / "tokei-collector.timer.template"
    if not service_template.exists() or not timer_template.exists():
        print("systemd templates missing", file=sys.stderr)
        return 2

    xdg_config = __import__("os").environ.get("XDG_CONFIG_HOME")
    unit_dir = (
        Path(xdg_config) / "systemd" / "user"
        if xdg_config
        else Path.home() / ".config" / "systemd" / "user"
    )
    unit_dir.mkdir(parents=True, exist_ok=True)

    service_content = service_template.read_text().replace("__TOKEI_BINARY__", _find_binary())
    timer_content = timer_template.read_text()

    service_dest = unit_dir / "tokei-collector.service"
    timer_dest = unit_dir / "tokei-collector.timer"
    service_dest.write_text(service_content)
    timer_dest.write_text(timer_content)

    print(f"Installed service: {service_dest}")
    print(f"Installed timer:   {timer_dest}")
    print("To activate:")
    print("  systemctl --user daemon-reload")
    print("  systemctl --user enable --now tokei-collector.timer")
    return 0
