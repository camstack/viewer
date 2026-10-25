#!/usr/bin/env python3
"""
Patch react-native-webrtc void native methods with @try/@catch blocks.

Fixes SIGABRT crashes under TurboModule interop where void RCT_EXPORT_METHOD
methods throw unhandled NSExceptions.
"""

import os
import re
import sys

# Base path for the react-native-webrtc source files
BASE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "node_modules", "react-native-webrtc", "ios", "RCTWebRTC",
)

# Files and their void methods to wrap
TARGETS = {
    os.path.join(BASE, "WebRTCModule+RTCPeerConnection.m"): [
        "peerConnectionSetConfiguration",
        "peerConnectionClose",
        "peerConnectionDispose",
        "peerConnectionRestartIce",
    ],
    os.path.join(BASE, "WebRTCModule+RTCMediaStream.m"): [
        "mediaStreamCreate",
        "mediaStreamAddTrack",
        "mediaStreamRemoveTrack",
        "mediaStreamRelease",
        "mediaStreamTrackRelease",
        "mediaStreamTrackSetEnabled",
        "mediaStreamTrackSetVolume",
        "mediaStreamTrackSetVideoEffects",
    ],
}

CATCH_TEMPLATE = (
    '}} @catch (NSException *exception) {{\n'
    '        NSLog(@"[RNWebRTC] Exception in {method}: %@", exception);\n'
    '    }}'
)


def find_method_body(source: str, method_name: str) -> tuple[int, int] | None:
    """
    Find the opening and closing brace positions for a
    RCT_EXPORT_METHOD(methodName ...) { ... } block.

    Returns (open_brace_pos, close_brace_pos) or None.
    """
    # Match RCT_EXPORT_METHOD( or RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(
    # followed by the method name. We need to find the opening '{' of the
    # method body, which comes after the macro's closing ')'.
    pattern = re.compile(
        r'RCT_EXPORT_METHOD\s*\(\s*' + re.escape(method_name) + r'\b'
    )
    match = pattern.search(source)
    if not match:
        return None

    # Walk forward from the match to find the macro's closing ')'.
    # The macro paren and ObjC selector colons live inside, so we need
    # to track parenthesis depth starting from the '(' of RCT_EXPORT_METHOD(.
    pos = source.index('(', match.start())
    paren_depth = 0
    while pos < len(source):
        ch = source[pos]
        if ch == '(':
            paren_depth += 1
        elif ch == ')':
            paren_depth -= 1
            if paren_depth == 0:
                break
        pos += 1

    # Now find the first '{' after the macro closing paren — that's the
    # method body opening brace.
    open_brace = source.index('{', pos + 1)

    # Count brace depth to find the matching closing '}'.
    brace_depth = 0
    i = open_brace
    while i < len(source):
        ch = source[i]
        if ch == '{':
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
            if brace_depth == 0:
                return (open_brace, i)
        i += 1

    return None


def wrap_method(source: str, method_name: str) -> tuple[str, bool]:
    """
    Wrap a single void method body in @try/@catch.
    Returns (modified_source, was_modified).
    """
    positions = find_method_body(source, method_name)
    if positions is None:
        print(f"  WARNING: method '{method_name}' not found — skipped")
        return source, False

    open_brace, close_brace = positions

    # Check if already wrapped
    body_preview = source[open_brace:open_brace + 80]
    if '@try' in body_preview:
        print(f"  SKIP (already wrapped): {method_name}")
        return source, False

    # Determine indentation (the line with the opening brace tells us)
    line_start = source.rfind('\n', 0, open_brace) + 1
    line_text = source[line_start:open_brace + 1]
    # Typically the opening brace is at the end of a line like
    #     "                      objectID) {"  — base indent is the method indent.
    # We'll use 4-space indent for the @try body.
    base_indent = '    '  # 4 spaces for ObjC method bodies

    # Build the @try opener (inserted right after '{')
    try_open = '\n' + base_indent + '@try {'

    # Build the @catch closer (inserted right before the closing '}')
    catch_close = (
        '\n' + base_indent +
        '} @catch (NSException *exception) {\n' +
        base_indent + base_indent +
        f'NSLog(@"[RNWebRTC] Exception in {method_name}: %@", exception);\n' +
        base_indent + '}\n'
    )

    # Insert catch block before the closing brace, and @try after opening brace.
    # Work from the end so positions don't shift.
    # The closing brace is at close_brace. Insert catch_close before it.
    source = source[:close_brace] + catch_close + source[close_brace:]
    # The opening brace is at open_brace. Insert @try right after it.
    source = source[:open_brace + 1] + try_open + source[open_brace + 1:]

    print(f"  WRAPPED: {method_name}")
    return source, True


def patch_file(filepath: str, methods: list[str]) -> int:
    """Patch all target methods in a single file. Returns count of methods wrapped."""
    if not os.path.isfile(filepath):
        print(f"ERROR: file not found: {filepath}")
        return 0

    with open(filepath, 'r') as f:
        source = f.read()

    count = 0
    for method in methods:
        source, modified = wrap_method(source, method)
        if modified:
            count += 1

    if count > 0:
        with open(filepath, 'w') as f:
            f.write(source)

    return count


def main():
    total = 0
    for filepath, methods in TARGETS.items():
        short = os.path.basename(filepath)
        print(f"\n--- {short} ---")
        total += patch_file(filepath, methods)

    print(f"\nDone. {total} method(s) wrapped with @try/@catch.\n")
    return 0 if total > 0 else 1


if __name__ == '__main__':
    sys.exit(main())
