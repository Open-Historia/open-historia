use crate::support::*;
use ohfronts::sim::constants::takers_for;
use ohfronts::sim::js::Val;

#[test]
fn constants_match_js() {
    run(
        "constants",
        &[("takersFor", &|case| {
            let area = case.arg(0).num();
            let takers = takers_for(if area > 0.0 { area } else { 0.0 });
            expect(case, Val::obj([("least", num(takers.least)), ("most", num(takers.most))]))
        })],
    );
}
