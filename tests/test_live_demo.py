"""What a public demo server must guarantee, and what a run must record about itself."""


import pytest
from fastapi.testclient import TestClient

from sakshi import usage_log


@pytest.fixture
def server(tmp_path, monkeypatch):
    import api.app as mod

    monkeypatch.setattr(mod, "CASES_DIR", tmp_path)
    monkeypatch.setattr(mod, "probe", lambda p: type("I", (), {"n": 250, "fps": 25.0}))
    return mod, TestClient(mod.app), tmp_path


def upload(client, data=b"x" * 10):
    return client.post("/cases", files={"video": ("clip.mp4", data, "video/mp4")}, data={"statements_json": "[]"})


def test_status_says_what_the_server_can_do(server, monkeypatch):
    mod, client, _ = server
    monkeypatch.setenv("MODEL_API_KEY", "")
    assert client.get("/cases/status").json()["live"] is False
    monkeypatch.setenv("MODEL_API_KEY", "k")
    assert client.get("/cases/status").json()["live"] is True


def test_access_code_guards_cases_and_nothing_else(server, monkeypatch):
    mod, client, tmp = server
    monkeypatch.setattr(mod, "ACCESS_CODE", "secret")
    assert client.get("/cases").status_code == 401
    assert upload(client).status_code == 401
    assert client.get("/cases/status").json()["code_required"] is True
    assert client.post("/cases/unlock", json={"code": "wrong"}).status_code == 401
    assert client.post("/cases/unlock", json={"code": "secret"}).status_code == 200
    assert client.get("/cases").status_code == 200
    assert upload(client).status_code == 200


def test_no_code_means_open_as_before(server):
    _, client, _ = server
    assert client.get("/cases").status_code == 200


def test_oversize_or_long_or_broken_clips_leave_nothing_behind(server, monkeypatch):
    mod, client, tmp = server
    monkeypatch.setattr(mod, "MAX_UPLOAD_MB", 1)
    assert upload(client, b"x" * (2 * 1024 * 1024)).status_code == 413
    monkeypatch.setattr(mod, "MAX_UPLOAD_MB", 200)
    monkeypatch.setattr(mod, "MAX_CLIP_SECONDS", 5)
    assert upload(client).status_code == 413
    monkeypatch.setattr(mod, "MAX_CLIP_SECONDS", 120)

    def broken(_):
        raise ValueError("not a video")

    monkeypatch.setattr(mod, "probe", broken)
    assert upload(client).status_code == 400
    assert not list(tmp.iterdir())


def test_a_run_sees_what_models_returned_but_the_log_does_not(tmp_path, monkeypatch):
    monkeypatch.setattr(usage_log, "LOG", tmp_path / "usage.jsonl")
    seen = []
    token = usage_log.observe(seen.append)
    with usage_log.logged("m", "job") as call:
        pass
    usage_log.show(call, {"text": "private statement"})
    usage_log.stop_observing(token)
    assert seen[0]["model"] == "m" and "private statement" in seen[0]["output"]
    assert "private" not in (tmp_path / "usage.jsonl").read_text()
    usage_log.show(call, "after the run")  # nobody listening: nothing happens
    assert len(seen) == 1


def test_long_outputs_are_shortened(tmp_path, monkeypatch):
    monkeypatch.setattr(usage_log, "LOG", tmp_path / "usage.jsonl")
    seen = []
    token = usage_log.observe(seen.append)
    with usage_log.logged("m", "job") as call:
        pass
    usage_log.show(call, "x" * 1000)
    usage_log.stop_observing(token)
    assert len(seen[0]["output"]) <= usage_log.MAX_SHOWN_CHARS + 1


def test_the_case_records_live_and_cached_calls():
    from sakshi.pipeline import _run_record

    calls = [{"cached": False, "seconds": 2.0}, {"cached": True, "seconds": 0.1}, {"cached": False, "seconds": 3.0}]
    assert _run_record(calls, None) == {"mode": "pipeline", "live_calls": 2, "cached_calls": 1, "live_seconds": 5.0}
    assert _run_record([], [{}])["mode"] == "replayed_tracks"
