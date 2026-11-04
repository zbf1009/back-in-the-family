//! Native headless runner. See `sim_cli::USAGE` or run `sim-cli --help`.

use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = Vec::new();
    for arg in std::env::args_os().skip(1) {
        match arg.into_string() {
            Ok(s) => args.push(s),
            Err(_) => {
                eprintln!("error: arguments must be valid UTF-8");
                return ExitCode::from(2);
            }
        }
    }
    let code = sim_cli::run(&args, &mut io::stdout().lock(), &mut io::stderr().lock());
    // Codes are 0, 1 or 2.
    ExitCode::from(u8::try_from(code).unwrap_or(2))
}
