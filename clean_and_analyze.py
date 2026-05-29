import pandas as pd
import json
import os
from datetime import datetime

# Pandas pipeline to clean the raw claims dataset for analysis
def clean_claims_pipeline(raw_csv, clean_csv, js_module):
    print("Loading raw insurance claims data...")
    if not os.path.exists(raw_csv):
        print(f"Error: {raw_csv} does not exist.")
        return
        
    df = pd.read_csv(raw_csv)
    print(f"Total raw records loaded: {len(df)}")
    
    # 1. Remove duplicate entries
    # Duplicates can happen due to logging errors. We drop them keeping the first record.
    initial_count = len(df)
    df = df.drop_duplicates(subset=["Claim_ID"], keep="first")
    print(f"Removed {initial_count - len(df)} duplicate records.")
    
    # 2. Standardize casing and strip whitespace from text categories
    text_cols = ["Customer_Segment", "Customer_Gender", "Region", "Product_Type", "Claim_Status"]
    for col in text_cols:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.title()
            
    # Quick fix for acronyms
    df["Customer_Segment"] = df["Customer_Segment"].replace("Sme", "SME")
    
    # Fill missing values for core categorical columns
    df["Region"] = df["Region"].replace("Nan", "Unknown").fillna("Unknown")
    df["Customer_Gender"] = df["Customer_Gender"].replace("Nan", "Unknown").fillna("Unknown")
    
    # Standardize to only allowed categories
    valid_products = ["Auto", "Health", "Home", "Life", "Travel"]
    df["Product_Type"] = df["Product_Type"].apply(lambda x: x if x in valid_products else "Health")
    
    # 3. Clean and impute Customer Age
    df["Customer_Age"] = pd.to_numeric(df["Customer_Age"], errors="coerce")
    # Fix negative values that might have been entered incorrectly
    df["Customer_Age"] = df["Customer_Age"].abs()
    
    # Impute missing or unreasonable ages (under 18 or over 100) using median
    median_age = df.loc[(df["Customer_Age"] >= 18) & (df["Customer_Age"] <= 100), "Customer_Age"].median()
    if pd.isna(median_age):
        median_age = 45 # Fallback
    else:
        median_age = int(median_age)
        
    df["Customer_Age"] = df["Customer_Age"].apply(
        lambda x: int(x) if (pd.notna(x) and 18 <= x <= 100) else median_age
    )
    
    # 4. Standardize Claim Date format to ISO YYYY-MM-DD
    # Handles mixed date inputs: YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY
    def standardize_date(date_str):
        if pd.isna(date_str):
            return "2024-06-01" # Default placeholder
        date_str = str(date_str).strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m-%d-%Y"):
            try:
                return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        return "2024-06-01"
        
    df["Claim_Date"] = df["Claim_Date"].apply(standardize_date)
    
    # 5. Financial metrics and business logic validation
    df["Claim_Amount"] = pd.to_numeric(df["Claim_Amount"], errors="coerce").fillna(1000.0).abs().round(2)
    df["Payout_Amount"] = pd.to_numeric(df["Payout_Amount"], errors="coerce").fillna(0.0).abs().round(2)
    
    # Reconcile status fields and payout logic
    valid_statuses = ["Approved", "Rejected", "Under Review"]
    df["Claim_Status"] = df["Claim_Status"].apply(lambda x: x if x in valid_statuses else "Under Review")
    
    # Business Rule 1: Rejected or Under Review claims must have payout of 0.00
    df.loc[df["Claim_Status"].isin(["Rejected", "Under Review"]), "Payout_Amount"] = 0.0
    
    # Business Rule 2: If Approved but payout is 0 or negative, set it to 85% of claimed amount
    df.loc[(df["Claim_Status"] == "Approved") & (df["Payout_Amount"] <= 0), "Payout_Amount"] = (df["Claim_Amount"] * 0.85).round(2)
    
    # Business Rule 3: Payout amount cannot exceed claimed amount
    df.loc[(df["Claim_Status"] == "Approved") & (df["Payout_Amount"] > df["Claim_Amount"]), "Payout_Amount"] = df["Claim_Amount"]
    
    # Business Rule 4: If Rejected, rejection reason must be documented
    df.loc[
        (df["Claim_Status"] == "Rejected") & 
        (df["Rejection_Reason"].isna() | (df["Rejection_Reason"].astype(str).str.strip() == "") | (df["Rejection_Reason"] == "N/A")), 
        "Rejection_Reason"
    ] = "Policy Exclusion"
    
    # Clear rejection reasons for approved or active claims
    df.loc[df["Claim_Status"] != "Rejected", "Rejection_Reason"] = ""
    
    # 6. Clean Processing Cycle (Days)
    df["Processing_Time_Days"] = pd.to_numeric(df["Processing_Time_Days"], errors="coerce")
    # For Under Review claims, there shouldn't be a cycle duration
    df.loc[df["Claim_Status"] == "Under Review", "Processing_Time_Days"] = pd.NA
    
    # For Approved/Rejected claims, fill missing/negative values with average processing duration (15 days)
    df.loc[
        df["Claim_Status"].isin(["Approved", "Rejected"]) & 
        (df["Processing_Time_Days"].isna() | (df["Processing_Time_Days"] < 0)), 
        "Processing_Time_Days"
    ] = 15
    
    # Save the cleaned dataset to CSV
    os.makedirs(os.path.dirname(clean_csv), exist_ok=True)
    df.to_csv(clean_csv, index=False)
    print(f"Cleaned dataset saved to CSV: {clean_csv}")
    
    # Save to JavaScript file format for dashboard consumption (handles local browser CORS issues)
    # We replace NaN values with empty strings before writing to JSON
    json_records = []
    for r in df.to_dict(orient="records"):
        cleaned_record = {k: ("" if pd.isna(v) or v is pd.NA else v) for k, v in r.items()}
        json_records.append(cleaned_record)
        
    os.makedirs(os.path.dirname(js_module), exist_ok=True)
    with open(js_module, "w", encoding="utf-8") as f:
        f.write("const CLAIMS_DATA = ")
        json.dump(json_records, f, indent=2)
        f.write(";\n")
    print(f"Cleaned dataset JSON module saved: {js_module}")

if __name__ == "__main__":
    clean_claims_pipeline(
        raw_csv="raw_claims_data.csv",
        clean_csv="dashboard/cleaned_claims_data.csv",
        js_module="dashboard/claims_data.js"
    )
