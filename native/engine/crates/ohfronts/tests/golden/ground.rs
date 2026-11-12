use crate::field::field_of;
use crate::support::*;
use ohfronts::sim::ground::*;
use ohfronts::sim::js::Val;

fn ints(value: &Val) -> Vec<i32> {
    arg_numbers(value).iter().map(|&n| n as i32).collect()
}

fn pair(out: &[f64; 2], like: &Val) -> Val {
    match like {
        Val::Typed(_) => f64s(out.to_vec()),
        _ => nums(out),
    }
}

#[test]
fn ground_matches_js() {
    run(
        "ground",
        &[
            ("nearestOf", &|case| {
                let (cols, rows) = (case.arg(0).num() as usize, case.arg(1).num() as usize);
                let mut out = ints(case.arg(3));
                let mut label = ints(case.arg(4));
                nearest_of(cols, rows, &ints(case.arg(2)), &mut out, &mut label);
                Some(expect_after(case, 3, &i32s(out)).and_then(|_| expect_after(case, 4, &i32s(label))))
            }),
            ("distanceFrom", &|case| {
                let script = Script::new(case, "2");
                let mut out = ints(case.arg(3));
                distance_from(case.arg(0).num() as usize, case.arg(1).num() as usize, |cell| script.call(&[num(cell as f64)]).truthy(), &mut out);
                Some(expect_after(case, 3, &i32s(out)).and_then(|_| script.done()))
            }),
            ("measure", &|case| {
                let field = field_of(case.arg(0).get("field"));
                let mut state = None;
                measure(&field, &mut state);
                let sides = state.unwrap().sides;
                expect(case, list(vec![i32s(sides[0].clone()), i32s(sides[1].clone())]))
            }),
            ("cellAt", &|case| expect(case, num(cell_at(&field_of(case.arg(0)), case.arg(1).num(), case.arg(2).num()) as f64))),
            ("cellsOf", &|case| expect(case, num(cells_of(&field_of(case.arg(0)), &ints(case.arg(1)), case.arg(2).num(), case.arg(3).num())))),
            ("downhill", &|case| {
                let mut out = [0.0; 2];
                let got = downhill(&field_of(case.arg(0)), &ints(case.arg(1)), case.arg(2).num(), case.arg(3).num(), &mut out);
                Some(expect(case, Val::Bool(got))?.and_then(|_| expect_after(case, 4, &pair(&out, case.arg(4)))))
            }),
            ("awayOf", &|case| {
                let battle = case.arg(0);
                let field = field_of(battle.get("field"));
                let to_side = ToSide { turns: field.turns, sides: [ints(battle.get("toSide").at(0)), ints(battle.get("toSide").at(1))] };
                expect(case, num(away_of(&field, &to_side, case.arg(1).num() as usize, case.arg(2).num(), case.arg(3).num())))
            }),
            ("outwardOf", &|case| {
                let mut out = [0.0; 2];
                let got = outward_of(&field_of(case.arg(0)), case.arg(1).num() as u8, case.arg(2).num(), case.arg(3).num(), case.arg(4).num(), &mut out);
                Some(expect(case, Val::Bool(got))?.and_then(|_| expect_after(case, 5, &pair(&out, case.arg(5)))))
            }),
            ("clearBetween", &|case| {
                let a = |at: usize| case.arg(at).num();
                expect(case, Val::Bool(clear_between(&field_of(case.arg(0)), a(1), a(2), a(3), a(4))))
            }),
            ("heldRound", &|case| {
                let a = |at: usize| case.arg(at).num();
                expect(case, num(held_round(&field_of(case.arg(0)), a(1) as u8, a(2), a(3), a(4))))
            }),
            ("cheapestWay", &|case| {
                let field = field_of(case.arg(0).get("field"));
                let way = cheapest_way(&field, case.arg(1).num() as i64, case.arg(2).num() as i64);
                expect(case, way.map(|way| list(way.iter().map(|&cell| num(cell as f64)).collect())).unwrap_or(Val::Null))
            }),
        ],
    );
}
