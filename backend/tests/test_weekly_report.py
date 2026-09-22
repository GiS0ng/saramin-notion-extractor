from scripts.weekly_report import parse_args


def test_parse_args_report_flags() -> None:
    args = parse_args(["--dry-run", "--skip-github"])

    assert args.dry_run is True
    assert args.skip_github is True


def test_parse_args_defaults_flags_to_false() -> None:
    args = parse_args([])

    assert args.dry_run is False
    assert args.skip_github is False
