use crate::field::field_val;
use crate::fronts::*;
use crate::support::{self, *};
use crate::walls::line_val;
use ohfronts::sim::battle::Battle;
use ohfronts::sim::combat::*;
use ohfronts::sim::engine::Run;
use ohfronts::sim::js::{Typed, Val};

fn claims_val(battle: &Battle) -> Val {
    Val::obj([("stamp", i32s(battle.claims.stamp.clone())), ("power", Val::Typed(Typed::F32(battle.claims.power.clone()))), ("moment", num(battle.claims.moment))])
}

fn mended_val(battle: &Battle) -> Val {
    list(battle.mended_by.iter().map(|side| list(side.iter().map(|entry| entry.map(num).unwrap_or(Val::Undef)).collect())).collect())
}

fn battle_like(run: &Run, case: &Case, battle: &Battle) -> Result<(), String> {
    let want = want_after(case, 0);
    if let Some(field) = &battle.field {
        same_parts(&field_val(field), want.get("field"), "field")?;
    }
    let got = Val::obj([
        ("claims", claims_val(battle)),
        ("log", list(battle.log.clone())),
        ("pool", nums(&battle.pool)),
        ("mendedBy", mended_val(battle)),
        ("look", battle.look.map(num).unwrap_or(Val::Undef)),
    ]);
    same_parts(&got, &want, "battle")?;
    if let Some(lines) = want.get("wallRun").get("lines").as_array() {
        let mine = run.lines.borrow();
        let got = list(mine.as_ref().map(|lines| lines.iter().map(line_val).collect()).unwrap_or_default());
        same(&got, &Val::Arr(lines.clone())).map_err(|error| format!("lines: {error}"))?;
    }
    troops_like(battle, &want)
}

#[test]
fn combat_matches_js() {
    support::run(
        "combat",
        &[
            ("squaresOf", &|case| {
                let run = bare_run();
                let mut battle = pick_battle(&run, case.arg(0));
                let troops: Vec<_> = case.arg(1).array_or_empty().iter().map(troop_full).collect();
                let script = Script::new(case, "2");
                let span = look_of(&mut battle);
                let field = battle.field.as_ref().unwrap();
                let squares = squares_of(span, field.cols, field.rows, &troops, |troop| {
                    let at = troops.iter().position(|other| std::ptr::eq(other, troop)).unwrap();
                    script.call(&[case.arg(1).at(at).clone()]).truthy()
                });
                let got = Val::obj([("heads", i32s(squares.heads)), ("nexts", i32s(squares.nexts)), ("across", num(squares.across)), ("down", num(squares.down)), ("span", num(squares.span))]);
                Some(expect_keys(case, got, &["heads", "nexts", "across", "down", "span"])?.and_then(|_| script.done()))
            }),
            ("eachNear", &|case| {
                let value = case.arg(0);
                let squares = Squares { heads: ints(value.get("heads")), nexts: ints(value.get("nexts")), across: value.get("across").num(), down: value.get("down").num(), span: value.get("span").num() };
                let listed = value.get("troops");
                let script = Script::new(case, "3");
                each_near(&squares, case.arg(1).num(), case.arg(2).num(), |at| {
                    script.call(&[listed.at(at).clone(), num(at as f64)]);
                });
                Some(expect(case, Val::Undef)?.and_then(|_| script.done()))
            }),
            ("stepForward", &|case| {
                let run = bare_run();
                let mut battle = pick_battle(&run, case.arg(0));
                let pace_km = arg_numbers(case.arg(1));
                let got = step_forward(&run, &mut battle, &pace_km, case.arg(2).num());
                Some(expect(case, num(got))?.and_then(|_| battle_like(&run, case, &battle)))
            }),
            ("closeDay", &|case| {
                if matches!(case.arg(0).get("mendOf"), Val::Fn) {
                    return None;
                }
                let run = bare_run();
                let mut battle = pick_battle(&run, case.arg(0));
                close_day(&run, &mut battle);
                Some(expect(case, Val::Undef)?.and_then(|_| battle_like(&run, case, &battle)))
            }),
        ],
    );
}
