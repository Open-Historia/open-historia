use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::js::Val;
use ohfronts::sim::mind::net::*;

fn optional_numbers(value: &Val) -> Option<Vec<f64>> {
    if value.is_object() {
        Some(arg_numbers(value))
    } else {
        None
    }
}

#[test]
fn mind_net_matches_js() {
    support::run(
        "mindNet",
        &[
            ("paramCount", &|case| expect(case, num(param_count(&Shape::of(case.arg(0)))))),
            ("blankState", &|case| expect(case, typed_f64(&blank_state(&Shape::of(case.arg(0)))))),
            ("step", &|case| {
                let got = step(&Shape::of(case.arg(0)), &arg_numbers(case.arg(1)), &arg_numbers(case.arg(2)), &arg_numbers(case.arg(3)));
                expect(case, Val::obj([("state", typed_f64(&got.state)), ("out", typed_f64(&got.out))]))
            }),
            ("headStep", &|case| {
                let lean = optional_numbers(case.arg(3));
                expect(case, typed_f64(&head_step(&Shape::of(case.arg(0)), &arg_numbers(case.arg(1)), &arg_numbers(case.arg(2)), lean.as_deref(), &arg_numbers(case.arg(4)))))
            }),
            ("packWeights", &|case| expect(case, pack_weights(&Shape::of(case.arg(0)), &arg_numbers(case.arg(1)), case.arg(2)))),
            ("readWeights", &|case| expect(case, read_weights(case.arg(0)).map(|weights| weights_val(&weights)).unwrap_or(Val::Null))),
        ],
    );
}
