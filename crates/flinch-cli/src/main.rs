use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Doctor,
    Harness {
        script: String,
    },
    Run {
        prompt: String,
    },
    Eval,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Doctor => {
            println!("Doctor...");
        }
        Commands::Harness { script } => {
            println!("Harness script: {}", script);
        }
        Commands::Run { prompt } => {
            println!("Run prompt: {}", prompt);
        }
        Commands::Eval => {
            println!("Eval...");
        }
    }

    Ok(())
}
