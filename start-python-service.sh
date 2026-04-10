#!/bin/bash
# Start Python Yahoo Finance service on boot

cd /Users/sshanoor/ClaudeProjects/Whiskie
python3 python-yahoo-service.py > python-yahoo-service.log 2>&1 &
echo $! > python-yahoo-service.pid
echo "Python Yahoo Finance service started (PID: $(cat python-yahoo-service.pid))"
