use crate::support::*;
use ohfronts::sim::unit_motion::hash_seed;

#[test]
fn unit_motion_matches_js() {
    run("unitMotion", &[("hashSeed", &|case| expect(case, num(hash_seed(&arg_text(case.arg(0))) as f64)))]);
}
