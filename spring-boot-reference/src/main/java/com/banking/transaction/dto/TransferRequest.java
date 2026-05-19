package com.banking.transaction.dto;

import lombok.Data;

@Data
public class TransferRequest {
    private String from;
    private String to;
    private Double amount;
    private String description;
    private String initiatorUid;
}
