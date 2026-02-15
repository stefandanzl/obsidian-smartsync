# Steps to improve the SmartSync Obsidian Plugin

## Status System

Check if the entire status system is implemented properly and improve it where required:

- locking any actions from being started as long as another one is currently running
- displaying the status symbol during actions and showing Notices when starting them

### Statuses

Currently we have a Status type defined that is like an enum of different strings and emojis that are used for display in the ui and also for locking logic. If the code would become cleaner add another datatype to allow for a more streamlined locking.

## Directory handling

We explicitly created functionality to add directories themselves to the filetrees aswell, complete with adding "/" at the end and assigning the pseudo hash "dir" for each of them
This is does not conform to classic sync algorithms like git
For this reason we should remove it again completely. The same will happen on the backend aswell.
At the end the code should be a lot simpler and cleaner and only keep track of actual files.
