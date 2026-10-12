# Tuition Centre Management System — User Guide

This guide explains the day-to-day functions of the desktop app, in the order most centres will use them. The app stores its database locally on the computer. Keep regular backups and use the same computer/database when you need the latest records.

## 1. First sign-in and navigation

1. Open the desktop app. On a new installation, create the tuition centre workspace and administrator account, and choose a local folder for student photos; otherwise, sign in with the account already set up.
2. Sign-in uses a username, not an email address. If you forget your username or password, choose **Forgot your username or password? Claim this account** and enter the workspace name and contact number saved on this computer. If no contact number was saved, leave that field blank. Recovery replaces the administrator username and password; it checks saved workspace details and does not verify identity through email.
3. If you cannot recover the account, choose **Reset all local data and start over** on the sign-in screen. Confirm the warning to erase all app records on this computer and return to first-time setup. This is permanent; use a backup if you need to keep your data.
4. Use the left navigation to open **Overview**, **Attendance**, **Payments**, **Reports**, **Students**, **Teachers**, **Classes**, or **Halls**. Open **Settings** near the bottom of the sidebar.
5. On a smaller window, open the navigation drawer with the menu button.
6. Use the search box in the top bar to enter an RFID card number and press **Enter**. If the card is assigned, the student profile opens. If it is not found, check the card number and its assignment on the Students page.
7. Sign out from the account area in the sidebar or the avatar in the top bar.

## 2. Recommended setup order

Set up the records in this order so that each later screen has the information it needs:

1. **Settings:** enter the centre name, contact number, and (optionally) the monthly student payment due day.
2. **Teachers:** add the teachers who teach your classes.
3. **Halls:** add any rooms that you want to assign to classes.
4. **Students:** add students and assign RFID cards if you use them.
5. **Classes:** create class details, weekly times, teacher commission and optional hall.
6. **Enrolments:** enrol students in the appropriate classes and set any individual discounts.
7. **Attendance:** generate sessions from the weekly timetable, then start and complete registers as classes take place.
8. **Payments:** record student tuition and teacher payouts, then check the balances and reports.

You can add or edit records later. For example, add a new student before enrolling them in a class.

## 3. Overview

1. Open **Overview** to review the current dashboard and the sessions scheduled for today.
2. Use the available shortcuts to open attendance or other relevant pages.
3. If today's class sessions do not appear, first confirm that the class is active and has a weekly schedule. Then open Attendance and use **Generate sessions**.

## 4. Students

### Add or edit a student

1. Open **Students**.
2. Select **Add student** to create a record, or select a student row to open their profile. Use the row action to edit.
3. Enter the student's name and primary contact; add any other available details such as school, secondary contact, birthday, address, status, profile photo or RFID card.
4. Save the record. Age is calculated from the birthday when available; it is not an independently maintained value.

### Find and manage a student

1. Use the student table search to find a record by the supported student details, including name, school, contact or RFID.
2. Open the student profile to review their class memberships and payment information.
3. Use the profile's edit controls to update student information or class-related details.
4. For RFID lookup from elsewhere in the app, enter the card number in the top-bar search and press **Enter**.

### Import students

1. Use the Students page's Excel template action to download the expected `.xlsx` format.
2. Fill the template, keeping the required student name and primary contact fields.
3. Choose the Excel import action and select the completed file.
4. Review any import error notification. Student imports add records to the current workspace; they do not replace existing records. The import accepts up to 5,000 records and files up to 20 MB.

## 5. Teachers

### Add or edit a teacher

1. Open **Teachers** and select **Add a teacher**.
2. Enter the teacher's name. Contact, address and a short description are optional.
3. Save. Open a teacher record to review or edit it.
4. Use the Excel template/import actions on the page if you need to add multiple teachers. The teacher name is required; imports add to the current workspace and have the same 5,000-record and 20 MB limits.

### Review teacher earnings and payouts

Teacher earnings are calculated from tuition payments for classes assigned to that teacher and each class's commission percentage. Recording a payout logs money actually paid; it does not itself collect student tuition.

1. Open **Payments → Teacher payments → Balances** to see this month's paid-out total, the total pending teacher balance, and each teacher's earned-to-date, paid-this-month and pending balance.
2. Filter the table by teacher if needed.
3. Select **Record teacher payout** to record an actual payment. Enter the teacher, date, amount, any class/month allocation and optional notes in the form.
4. Open **Payout history** to filter recorded payouts by teacher and period. The history can be exported as a PDF.

## 6. Halls

Halls has three tabs: **Availability calendar**, **Find availability**, and **Halls list**.

### Add or edit a hall

1. Open **Halls** and select **Add a hall**.
2. Enter the hall name and optional capacity.
3. The weekly availability starts with Monday through Sunday, 07:00–23:00. Edit, add or remove availability slots to match the room's real opening times.
4. Save. Editing an existing hall keeps its current availability unless you change it.

### Check availability

1. Choose **Availability calendar** to see the halls' weekly open periods.
2. Choose **Find availability** to select a day, start time and end time.
3. Review the matching halls and their capacities. A hall is listed only when its availability covers the full time range and there is no overlapping class booking.
4. Choose **Halls list** to search, review and edit hall records.

## 7. Classes and enrolments

### Create or edit a class

1. Open **Classes** and select the create-class action, or open a class and choose **Edit class**.
2. Enter the class name and subject, then choose its teacher.
3. Enter the monthly fee and the teacher commission percentage. The commission percentage determines how collected tuition is split between teacher earnings and the centre's share.
4. Optionally assign a hall and set the class status.
5. Add one or more weekly schedule entries. Each entry has a day, start time and end time. Schedule entries are shown two per row; use **Add time** or the remove control to change them.
6. Save the class.

### Enrol students and apply discounts

1. Open a class and review the enrolled-student list. Use its search field to find an enrolled student.
2. Select **Enroll students** on the right, search available students, and select one or more students.
3. Enter an optional discount percentage for each student. A zero discount means the full class fee; a 100% discount means no tuition is due.
4. Review the displayed student fee and, for selected students, the teacher and centre shares.
5. Select **Enroll selected** to save the enrolments.
6. Use **Edit discount** beside an enrolled student to change their discount. Use the remove control to drop a student from the class.
7. Use **Payment Register PDF** in the class details header to export the annual payment register. The class form's **Edit class** control changes the class setup and schedule.

An active student enrolled at a 100% discount has **Free Access** instead of a payment action wherever tuition payment is offered. Their payable tuition is zero.

## 8. Attendance and sessions

### Prepare the daily session list

1. Open **Attendance** and choose the required date using the date field, previous/next controls or **Today**.
2. Select **Generate sessions** to create sessions for classes scheduled on that date. Generating again is safe if the timetable is already up to date; duplicate sessions are not added.
3. To add a one-off class outside its weekly timetable, select **Add special session**, choose an active class, date, time and optional hall, and save. The app checks hall availability and overlapping bookings.
4. Use the page search to filter the session cards by class, subject or status.

### Take attendance

1. Select **Start session** on the appropriate session card. This opens the attendance register for the class.
2. Start the class when it begins using the class-start control. The register-open time and class-start time are tracked separately.
3. Select a student and mark them **Present** or **Absent**. If using RFID, scan or enter the card number to find the student and mark attendance.
4. The selected student's details appear in the detail panel. A birthday notice appears when the session date is the student's birthday. Students marked present on a 100% discount are identified as **Free Access student**.
5. A yellow low-attendance warning appears for a student absent from the last two eligible completed sessions.
6. If tuition is collected at the session, use the payment action for the student. Fully discounted students have no payment action. Monthly duplicate-payment safeguards still apply.
7. Use **End session** when the class is finished. Any students left unmarked are then recorded as absent, and the session is completed.
8. Use the session's attendance export control to save its attendance report as a PDF.

### Automatic session ending

Sessions still open at the end of the day are automatically completed. Students whose attendance is still unmarked are marked absent. Automatically ended sessions are identified in red as **Automatically ended**. To keep the record accurate, finish the register manually after class rather than relying on the automatic end-of-day process.

Completed sessions can be opened with **View register**. Their attendance is available for review and reporting.

## 9. Payments

The Payments page has **Make payment**, **Student payments**, **Teacher payments**, and **Payment records** tabs. **Make payment** opens by default.

### Make a student payment

1. Open **Payments → Make payment** and search students by name or RFID.
2. Select one or more students. Their unpaid monthly class fees appear automatically, with earlier months first; previous months are highlighted in red.
3. All displayed fees are selected by default. Deselect any fee that should not be included, then review the total at the bottom.
4. Select **Make payment** and confirm the listed fees. A unique 8-digit receipt number is created for the batch.
5. After recording, choose **Print receipt** to print it or **Download receipt** to save a PDF. The receipt includes its number, payment date and time, student and class names, paid months, per-item amounts, and total paid.
6. **Payment records** shows the latest four receipts with student name(s), total paid, and number of class-fee records. Use **View** for the class-by-class receipt, or print/download the PDF directly from the list. You can also enter or scan a receipt number to find any receipt.
7. A 100%-discount enrolment has no amount due and is not offered as a payable item.

Student tuition can also be marked paid from an active attendance register or the existing **Student payments** tab. These payment flows also create a receipt number, and duplicate class/month payments remain blocked.

### Review student payment history

Select a student and choose a period (recent months, a selected month or a custom month range) to view their payment history. Use the PDF export action to export the filtered history.

### Record a teacher payout

1. Open **Payments → Teacher payments**.
2. In **Balances**, check the teacher's paid-this-month and pending totals.
3. Select **Record teacher payout**, enter the payout details, and save only after the payment has actually been made.
4. Review it in **Payout history**, where you can filter by teacher and period or export a PDF.

The green paid-this-month value is the amount of payouts recorded in the current calendar month. Pending balance is the teacher's earned amount to date minus payouts already recorded.

## 10. Reports

Open **Reports** and choose the appropriate tab. Most financial reports use the month selector near the top of the page.

### Student reports

1. Choose **Student reports**.
2. Set a month and optionally select a student to filter the report.
3. Review attendance, payment history and pending tuition records for the selected period.

### Teacher reports

1. Choose **Teacher reports**.
2. Review teacher balances: earned to date, paid out and remaining balance.
3. Review the payout records and their dates, class/month allocations and notes.
4. Use **Add payout** if an actual teacher payment needs to be recorded.

### Class reports

1. Choose **Class reports** and select a month.
2. Review total collected, outstanding tuition, teacher share and centre share. Per-class rows show enrolment, paid/due counts, collected amounts and pending shares.
3. Search for a class or teacher as needed.
4. Use **Print [year] Payment Sheets** to export annual class payment-register PDFs, with a separate sheet for each class.

### Session reports

1. Choose **Sessions**.
2. Select **From date** and **To date**. The same date in both fields gives a single-day report.
3. Optionally choose a teacher to see only sessions conducted by that teacher.
4. Review the date, class, time, teacher, present/enrolled count and session status.

### Daily summary

At the top of Reports, choose a date in the daily-summary section and select its PDF action. The summary includes receipts, teacher payouts, student totals and session attendance for the selected date.

## 11. Settings, payment due date and backups

### Centre details and overdue reminders

1. Open **Settings → Organization details**.
2. Update the centre name and contact number.
3. Optionally set the recurring student payment due day from 1 to 31, then save.
4. After the due day, unpaid monthly fees may produce a yellow warning in attendance; the warning does not block attendance. The selected day is clamped to the last day in shorter months. Leave the due day blank to disable overdue warnings.

### Student photo folder

1. During first-time setup, choose the folder where student photos should be stored.
2. To change it later, open **Settings → Student photo storage**, choose a folder and save. Existing photos are moved to the new folder.

### Back up or restore

1. Open **Settings → Backup & restore**.
2. Select **Back up now** and choose a folder and filename for a local database copy. Store the backup somewhere safe, preferably separate from the computer.
3. To restore, select **Choose file** and choose a verified database backup. A safety copy of the current database is made before the restore.
4. The app refreshes after a successful restore. Make sure you selected the intended backup because restoring replaces the current workspace data with the backup's data.
5. Backups include database records and photo paths, not the actual image files. Keep the student photo folder when moving the app or restoring a backup if you need the photos.

## 12. Helpful operating notes

- Keep class schedules, teacher assignments and enrolments current before generating attendance sessions.
- Generate sessions for the date you are working on; a weekly schedule alone does not create the visible attendance register until sessions have been generated.
- End each register manually after class. This ensures unmarked students are finalized promptly and avoids sessions being marked as automatically ended.
- Record student payments and teacher payouts only when money has actually been received or paid.
- A 100% discount means free access, not a normal zero-value payment.
- Keep student contact and birthday details accurate so the register can show the correct student information and birthday notices.
- Back up regularly, especially before restoring a database or moving the app to another computer.
- Amounts use the computer's locale number formatting. The app does not currently store a separate currency code; use one consistent currency for records in a workspace.
- The database and local backup files are not encrypted. Protect the computer and any folders containing backups.
- Current account-management features do not expose staff-account creation in the interface. Google Drive backup is not configured; use the local backup/restore controls.
