use crate::support::*;
use ohfronts::sim::deploy::*;
use ohfronts::sim::js::Val;
use ohfronts::sim::manpower::*;
use ohfronts::sim::muster::*;

fn levy_val(levy: &Levy) -> Val {
    Val::obj([("o", num(levy.o)), ("t", num(levy.t)), ("r", num(levy.r)), ("f", text(&levy.f))])
}

fn levy_of(value: &Val) -> Levy {
    Levy { o: value.get("o").num(), t: value.get("t").num(), r: value.get("r").num(), f: value.get("f").string_or_empty() }
}

fn sides_val(deploy: &[Vec<DeployLine>; 2]) -> Val {
    list(deploy.iter().map(|lines| list(lines.iter().map(line_val).collect())).collect())
}

#[test]
fn muster_matches_js() {
    run(
        "muster",
        &[
            ("spreadPick", &|case| expect(case, list(spread_pick(case.arg(0).num(), case.arg(1).num()).iter().map(|&at| num(at as f64)).collect()))),
            ("readLevy", &|case| {
                let levy = read_levy(case.arg(0));
                expect(case, list(levy.iter().map(|side| list(side.iter().map(levy_val).collect())).collect()))
            }),
            ("levyPending", &|case| {
                let side = case.arg(0).get(&js_key(case.arg(1)));
                let entries: Vec<Levy> = side.array_or_empty().iter().map(levy_of).collect();
                expect(case, num(levy_pending(&entries)))
            }),
            ("levyOwed", &|case| {
                let side = |at: usize| -> Vec<Levy> { case.arg(0).at(at).array_or_empty().iter().map(levy_of).collect() };
                expect(case, Val::Bool(levy_owed(&[side(0), side(1)])))
            }),
        ],
    );
}

fn js_key(value: &Val) -> String {
    ohfronts::sim::js::to_string(value)
}

#[test]
fn deploy_matches_js() {
    run(
        "deploy",
        &[
            ("readDeploy", &|case| expect(case, sides_val(&read_deploy(case.arg(0))))),
            ("hasDeploy", &|case| expect(case, Val::Bool(has_deploy(case.arg(0))))),
            ("deployLinesOf", &|case| expect(case, list(deploy_lines_of(case.arg(0), case.arg(1)).iter().map(line_val).collect()))),
            ("withDeployLine", &|case| {
                let options = case.arg(2);
                let form = if options.get("form").is_undef() { Val::str("") } else { options.get("form").clone() };
                expect(case, with_deploy_line(case.arg(0), case.arg(1), options.get("country"), options.get("way"), &form, options.get("call")))
            }),
        ],
    );
}

#[test]
fn manpower_matches_js() {
    run(
        "manpower",
        &[
            ("menPerFormation", &|case| expect(case, men_per_formation(case.arg(0)).map(num).unwrap_or(Val::Undef))),
            ("shareOf", &|case| {
                let state = case.arg(0);
                let script = Script::new(case, "0.militaryOf");
                let own = if state.get("mech").get("military").truthy() {
                    let found = script.call(std::slice::from_ref(case.arg(1)));
                    let share = found.get("manpowerShare");
                    if share.is_nullish() {
                        None
                    } else {
                        Some(share.num())
                    }
                } else {
                    None
                };
                Some(expect(case, num(share_of(state.get("manpowerShare").num(), own)))?.and_then(|_| script.done()))
            }),
        ],
    );
}
