//! CLI behavior tests: `--check` validates a spec headlessly (no terminal)
//! and `--help` prints usage. These run the real binary.

use std::process::Command;

fn write_spec(name: &str, body: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("rataflow-view-test-{name}.json"));
    std::fs::write(&path, body).expect("write spec fixture");
    path
}

#[test]
fn check_flag_prints_a_summary_and_exits_zero() {
    let path = write_spec(
        "ok",
        r#"{"direction":"lr","edges":[{"from":"a","to":"b"}]}"#,
    );
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("ok: nodes=2 edges=1 flows=0 direction=lr theme=gruvbox"),
        "stdout: {stdout}"
    );
    std::fs::remove_file(path).ok();
}

#[test]
fn check_flag_counts_flow_edges() {
    let path = write_spec(
        "flows",
        r#"{"edges":[{"from":"a","to":"b","flow":true},
                     {"from":"b","to":"c","flow":2}]}"#,
    );
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("nodes=3 edges=2 flows=2"),
        "stdout: {stdout}"
    );
    std::fs::remove_file(path).ok();
}

#[test]
fn check_flag_rejects_a_non_positive_flow_speed() {
    let path = write_spec("badflow", r#"{"edges":[{"from":"a","to":"b","flow":0}]}"#);
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(!out.status.success(), "a bad flow speed must exit non-zero");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("flow"), "stderr: {stderr}");
    std::fs::remove_file(path).ok();
}

#[test]
fn check_flag_rejects_a_bad_spec_without_a_terminal() {
    let path = write_spec("bad", r#"{"egdes":[{"from":"a","to":"b"}]}"#);
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(!out.status.success(), "a bad spec must exit non-zero");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("egdes"), "stderr: {stderr}");
    std::fs::remove_file(path).ok();
}

#[test]
fn help_flag_prints_usage() {
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--help")
        .output()
        .expect("run the binary");
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("usage:"), "stdout: {stdout}");
    assert!(stdout.contains("--check"), "stdout: {stdout}");
}
