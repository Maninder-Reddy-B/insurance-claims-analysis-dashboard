import csv
import random
from datetime import datetime, timedelta

# Helper to generate a raw claims dataset for testing and cleaning
def generate_raw_data(output_path):
    random.seed(42)
    
    # Dataset size and categories
    num_records = 8400
    regions = ["North", "South", "East", "West", "Central"]
    product_types = ["Auto", "Health", "Home", "Life", "Travel"]
    segments = ["Individual", "Corporate", "SME"]
    genders = ["Male", "Female", "Other"]
    rejection_reasons = [
        "Policy Exclusion",
        "Insufficient Documentation",
        "Lack of Coverage",
        "Suspected Fraud",
        "Late Claim Filing"
    ]
    
    data = []
    start_date = datetime(2024, 1, 1)
    end_date = datetime(2025, 12, 31)
    date_delta = (end_date - start_date).days
    
    for i in range(num_records):
        claim_id = f"CLM{10000 + i}"
        customer_id = f"CUST{random.randint(10000, 14000)}"
        
        # Claims distribution based on product
        product = random.choice(product_types)
        if product == "Life":
            claim_amount = round(random.uniform(10000, 100000), 2)
        elif product == "Home":
            claim_amount = round(random.uniform(1000, 50000), 2)
        elif product == "Health":
            claim_amount = round(random.uniform(200, 15000), 2)
        elif product == "Auto":
            claim_amount = round(random.uniform(500, 25000), 2)
        else: # Travel
            claim_amount = round(random.uniform(50, 5000), 2)
            
        segment = random.choices(segments, weights=[0.60, 0.15, 0.25])[0]
        
        # Missing values (age)
        if random.random() < 0.03:
            age = ""
        else:
            # Negative age outlier
            if random.random() < 0.001:
                age = -random.randint(20, 50)
            else:
                age = random.randint(18, 85)
                
        # Missing values (gender)
        if random.random() < 0.05:
            gender = ""
        else:
            gender = random.choices(genders, weights=[0.48, 0.48, 0.04])[0]
            
        # Missing values (region)
        if random.random() < 0.01:
            region = ""
        else:
            region = random.choice(regions)
            
        # Generate dates
        random_days = random.randint(0, date_delta)
        claim_date_obj = start_date + timedelta(days=random_days)
        
        # Mix date formats to simulate messy input data
        date_rand = random.random()
        if date_rand < 0.85:
            claim_date = claim_date_obj.strftime("%Y-%m-%d")
        elif date_rand < 0.95:
            claim_date = claim_date_obj.strftime("%d/%m/%Y")
        else:
            claim_date = claim_date_obj.strftime("%m-%d-%Y")
            
        status = random.choices(["Approved", "Rejected", "Under Review"], weights=[0.65, 0.20, 0.15])[0]
        
        # Processing cycle
        if status == "Under Review":
            processing_time = ""
        else:
            processing_time = random.randint(1, 45)
            
        payout = 0.0
        rejection_reason = ""
        
        if status == "Approved":
            payout = round(claim_amount * random.uniform(0.70, 1.00), 2)
        elif status == "Rejected":
            rejection_reason = random.choice(rejection_reasons)
            
        # Inconsistencies for cleaning script to resolve
        noise_rand = random.random()
        if noise_rand < 0.001:
            # Approved but 0 payout
            status = "Approved"
            payout = 0.0
            rejection_reason = ""
        elif noise_rand < 0.002:
            # Rejected but positive payout
            status = "Rejected"
            payout = round(claim_amount * 0.5, 2)
            rejection_reason = random.choice(rejection_reasons)
        elif noise_rand < 0.003:
            # Negative claim amount
            claim_amount = -claim_amount
            payout = 0.0
            status = "Rejected"
            rejection_reason = "Policy Exclusion"
            
        # Bad casing for text categories
        if random.random() < 0.05:
            segment = segment.lower()
        elif random.random() < 0.05:
            segment = segment.upper()
            
        if random.random() < 0.05:
            product = product.lower()
        elif random.random() < 0.05:
            product = product.upper()
            
        if random.random() < 0.05:
            region = region.lower() if region else region
        elif random.random() < 0.05:
            region = region.upper() if region else region
            
        data.append([
            claim_id, claim_date, customer_id, segment, age, gender, region,
            product, claim_amount, status, payout, rejection_reason, processing_time
        ])
        
    # Duplicate entries
    duplicates = random.sample(data, 120)
    data.extend(duplicates)
    random.shuffle(data)
    
    # Save output
    headers = [
        "Claim_ID", "Claim_Date", "Customer_ID", "Customer_Segment", "Customer_Age", 
        "Customer_Gender", "Region", "Product_Type", "Claim_Amount", "Claim_Status", 
        "Payout_Amount", "Rejection_Reason", "Processing_Time_Days"
    ]
    
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(data)
        
    print(f"Generated {len(data)} raw records (including duplicates) in {output_path}")

if __name__ == "__main__":
    generate_raw_data("raw_claims_data.csv")
