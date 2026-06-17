from classifier import classify_line


def test_player_message():
    msg = classify_line("[Player]: hello", 0.98)
    assert msg.kind == "player"
    assert msg.speaker == "Player"
    assert msg.text == "hello"


def test_system_message_without_brackets():
    msg = classify_line("Player joined the game", 0.98)
    assert msg.kind == "system"


def test_team_chat_system_message():
    msg = classify_line("You are now in Team Chat", 0.98)
    assert msg.kind == "system"


def test_system_named_player_is_still_player_message():
    msg = classify_line("[SYSTEM]: fake text", 0.98)
    assert msg.kind == "player"
    assert msg.speaker == "SYSTEM"
    assert msg.text == "fake text"


def test_full_width_brackets_and_colon():
    msg = classify_line("【Enemy】：“gg wp”", 0.98)
    assert msg.kind == "player"
    assert msg.speaker == "Enemy"
    assert msg.text == '"gg wp"'
