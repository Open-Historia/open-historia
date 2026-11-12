use crate::support::*;
use ohfronts::sim::game_dates::*;
use ohfronts::sim::js::Val;

fn date_val(parts: Option<GameDate>) -> Val {
    match parts {
        Some(parts) => Val::obj([("year", num(parts.year)), ("month", num(parts.month)), ("day", num(parts.day))]),
        None => Val::Null,
    }
}

fn finite_or_nan(value: &Val) -> f64 {
    match value {
        Val::Num(n) => *n,
        _ => f64::NAN,
    }
}

#[test]
fn game_dates_match_js() {
    run(
        "gameDates",
        &[
            ("addGameDays", &|case| expect(case, text(&add_game_days(&arg_text(case.arg(0)), finite_or_nan(case.arg(1)))))),
            ("addGameMonths", &|case| expect(case, text(&add_game_months(&arg_text(case.arg(0)), finite_or_nan(case.arg(1)))))),
            ("compareGameDates", &|case| expect(case, num(compare_game_dates(&arg_text(case.arg(0)), &arg_text(case.arg(1)))))),
            ("diffGameDays", &|case| expect(case, opt_num(diff_game_days(&arg_text(case.arg(0)), &arg_text(case.arg(1)))))),
            ("gameDateDayNumber", &|case| expect(case, opt_num(game_date_day_number(&arg_text(case.arg(0)))))),
            ("gameDateYear", &|case| expect(case, opt_num(game_date_year(&arg_text(case.arg(0)))))),
            ("normalizeGameDate", &|case| expect(case, text(&normalize_game_date(&arg_text(case.arg(0)))))),
            ("parseGameDate", &|case| expect(case, date_val(parse_game_date(&arg_text(case.arg(0)))))),
        ],
    );
}
