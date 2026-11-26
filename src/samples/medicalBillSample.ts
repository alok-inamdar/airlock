/**
 * Demo pack: ER medical bill with a duplicate CPT 99284 line, a potential
 * unbundling review, and a potential chargemaster markup.
 *
 * All names, IDs, and payment details are fictional. The SSN is the
 * known-invalid 000-00-0000, and the card is a public test number.
 */

export const MEDICAL_BILL_SAMPLE = `METRO GENERAL HOSPITAL
1400 Harrison Street, San Francisco, CA 94103
Phone: (415) 555-0134
Email: billing@metrogeneral.example.org

PATIENT STATEMENT — EMERGENCY DEPARTMENT
Statement date: 02/18/2026

Patient: Rohan Sharma
DOB: 03/14/1979
MRN: MG-8842197
Policy ID: BCS-99214-XT
Address: 2847 Fulton Street, Apt 12, San Francisco, CA 94118
Email: rohan.sharma@example.com
Phone: (415) 555-0177
SSN (on file): 000-00-0000

Insurer: BlueCrest Health Plan
Provider: Dr. Alicia Nguyen
Attending: Dr. Samuel Okafor
Date of service: 02/11/2026

STATEMENT SUMMARY
Account Number: 4471 8820 1193
Routing Number: 123456789
Card on file: 4111 1111 1111 1111 (test card)

ITEMIZED CHARGES
CPT 99284   Emergency department visit, level 4, facility fee   $1,450.00
CPT 99284   Emergency department visit, level 4, facility fee   $1,450.00
CPT 36415   Routine venipuncture, finger/heel/ear stick          $85.00
NDC 00093-0148-01   Ibuprofen 800 mg tablet, single dose         $140.00
CPT 74177   CT abdomen and pelvis with contrast                 $1,695.00

TOTAL CHARGES: $4,820.00
INSURANCE PAYMENT: -$3,100.00
PATIENT RESPONSIBILITY: $1,720.00

NOTES
- Two emergency department facility fees appear for the same date of service.
- Venipuncture was performed during the emergency visit.
- Charges shown are gross chargemaster rates before payer adjustment.
- This statement may include services still under review by your insurer.

Questions? Call (415) 555-0134 or email billing@metrogeneral.example.org.
Metro General Hospital is a fictional provider created for this demo.`;
